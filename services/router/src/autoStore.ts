/** AutoRun / AutoTrial / AutoRunner persistence (D1 or Convex HTTP). */

import type {
  AutoBoxState,
  AutoComputeConfig,
  AutoProgress,
  AutoProtocol,
  AutoRepoBind,
  AutoRun,
  AutoRunStatus,
  AutoRunner,
  AutoTrial,
  AutoTrialStatus,
} from "@trainfabric/shared";

export interface AutoStore {
  upsertAutoRun(body: Partial<AutoRun> & { id: string; status: AutoRunStatus }): Promise<void>;
  getAutoRun(id: string): Promise<AutoRun | null>;
  listAutoRuns(datasetId: string): Promise<AutoRun[]>;
  upsertAutoTrial(
    body: Partial<AutoTrial> & { id: string; status: AutoTrialStatus; autoRunId?: string },
  ): Promise<void>;
  getAutoTrial(id: string): Promise<AutoTrial | null>;
  listAutoTrials(autoRunId: string): Promise<AutoTrial[]>;
  claimPendingTrial(runnerId: string): Promise<AutoTrial | null>;
  upsertAutoRunner(
    body: Partial<AutoRunner> & { id: string },
  ): Promise<AutoRunner>;
  getAutoRunnerByTokenHash(tokenHash: string): Promise<AutoRunner | null>;
  listAutoRunners(ownerId: string): Promise<AutoRunner[]>;
}

async function ensureAutoSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS auto_runs (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        repo_json TEXT NOT NULL,
        protocol_json TEXT NOT NULL,
        box_json TEXT NOT NULL DEFAULT '{}',
        compute_json TEXT NOT NULL,
        progress_json TEXT NOT NULL,
        result_ref TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS auto_trials (
        id TEXT PRIMARY KEY,
        auto_run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        hypothesis TEXT,
        commit_sha TEXT,
        external_id TEXT,
        score REAL,
        kept INTEGER,
        artifact_ref TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS auto_runners (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        capacity TEXT,
        last_heartbeat_at INTEGER,
        created_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_auto_runs_dataset ON auto_runs(dataset_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_auto_trials_run ON auto_trials(auto_run_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_auto_trials_status ON auto_trials(status)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_auto_runners_token ON auto_runners(token_hash)`).run();
}

function rowToRun(r: Record<string, unknown>): AutoRun {
  return {
    id: String(r.id),
    datasetId: String(r.dataset_id),
    ownerId: String(r.owner_id),
    status: r.status as AutoRunStatus,
    repo: JSON.parse(String(r.repo_json)) as AutoRepoBind,
    protocol: JSON.parse(String(r.protocol_json)) as AutoProtocol,
    box: JSON.parse(String(r.box_json || "{}")) as AutoBoxState,
    compute: JSON.parse(String(r.compute_json)) as AutoComputeConfig,
    progress: JSON.parse(String(r.progress_json)) as AutoProgress,
    resultRef: r.result_ref ? String(r.result_ref) : undefined,
    error: r.error ? String(r.error) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToTrial(r: Record<string, unknown>): AutoTrial {
  return {
    id: String(r.id),
    autoRunId: String(r.auto_run_id),
    status: r.status as AutoTrialStatus,
    hypothesis: r.hypothesis ? String(r.hypothesis) : undefined,
    commitSha: r.commit_sha ? String(r.commit_sha) : undefined,
    externalId: r.external_id ? String(r.external_id) : undefined,
    score: r.score != null ? Number(r.score) : undefined,
    kept: r.kept == null ? undefined : Boolean(r.kept),
    artifactRef: r.artifact_ref ? String(r.artifact_ref) : undefined,
    error: r.error ? String(r.error) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToRunner(r: Record<string, unknown>): AutoRunner {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    name: String(r.name),
    tokenHash: String(r.token_hash),
    capacity: r.capacity ? String(r.capacity) : undefined,
    lastHeartbeatAt: r.last_heartbeat_at != null ? Number(r.last_heartbeat_at) : undefined,
    createdAt: Number(r.created_at),
  };
}

export function createD1AutoStore(db: D1Database): AutoStore {
  return {
    async upsertAutoRun(body) {
      await ensureAutoSchema(db);
      const existing = await db.prepare("SELECT * FROM auto_runs WHERE id = ?").bind(body.id).first();
      const now = Date.now();
      if (existing) {
        const cur = rowToRun(existing as Record<string, unknown>);
        await db
          .prepare(
            `UPDATE auto_runs SET status=?, repo_json=?, protocol_json=?, box_json=?, compute_json=?,
             progress_json=?, result_ref=COALESCE(?, result_ref), error=?, updated_at=? WHERE id=?`,
          )
          .bind(
            body.status,
            JSON.stringify(body.repo ?? cur.repo),
            JSON.stringify(body.protocol ?? cur.protocol),
            JSON.stringify(body.box ?? cur.box),
            JSON.stringify(body.compute ?? cur.compute),
            JSON.stringify(body.progress ?? cur.progress),
            body.resultRef ?? null,
            body.error ?? null,
            now,
            body.id,
          )
          .run();
        return;
      }
      if (!body.datasetId || !body.ownerId || !body.repo || !body.protocol || !body.compute) {
        throw new Error("create AutoRun requires datasetId, ownerId, repo, protocol, compute");
      }
      await db
        .prepare(
          `INSERT INTO auto_runs
           (id, dataset_id, owner_id, status, repo_json, protocol_json, box_json, compute_json, progress_json, result_ref, error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          body.id,
          body.datasetId,
          body.ownerId,
          body.status,
          JSON.stringify(body.repo),
          JSON.stringify(body.protocol),
          JSON.stringify(body.box ?? {}),
          JSON.stringify(body.compute),
          JSON.stringify(body.progress ?? { trial: 0, updatedAt: now }),
          body.resultRef ?? null,
          body.error ?? null,
          now,
          now,
        )
        .run();
    },

    async getAutoRun(id) {
      await ensureAutoSchema(db);
      const r = await db.prepare("SELECT * FROM auto_runs WHERE id = ?").bind(id).first();
      return r ? rowToRun(r as Record<string, unknown>) : null;
    },

    async listAutoRuns(datasetId) {
      await ensureAutoSchema(db);
      const { results } = await db
        .prepare("SELECT * FROM auto_runs WHERE dataset_id = ? ORDER BY created_at DESC")
        .bind(datasetId)
        .all();
      return (results ?? []).map((r) => rowToRun(r as Record<string, unknown>));
    },

    async upsertAutoTrial(body) {
      await ensureAutoSchema(db);
      const existing = await db.prepare("SELECT * FROM auto_trials WHERE id = ?").bind(body.id).first();
      const now = Date.now();
      if (existing) {
        const cur = rowToTrial(existing as Record<string, unknown>);
        await db
          .prepare(
            `UPDATE auto_trials SET status=?, hypothesis=COALESCE(?, hypothesis), commit_sha=COALESCE(?, commit_sha),
             external_id=COALESCE(?, external_id), score=COALESCE(?, score), kept=COALESCE(?, kept),
             artifact_ref=COALESCE(?, artifact_ref), error=?, updated_at=? WHERE id=?`,
          )
          .bind(
            body.status,
            body.hypothesis ?? null,
            body.commitSha ?? null,
            body.externalId ?? null,
            body.score ?? null,
            body.kept == null ? null : body.kept ? 1 : 0,
            body.artifactRef ?? null,
            body.error ?? null,
            now,
            body.id,
          )
          .run();
        void cur;
        return;
      }
      if (!body.autoRunId) throw new Error("create AutoTrial requires autoRunId");
      await db
        .prepare(
          `INSERT INTO auto_trials
           (id, auto_run_id, status, hypothesis, commit_sha, external_id, score, kept, artifact_ref, error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          body.id,
          body.autoRunId,
          body.status,
          body.hypothesis ?? null,
          body.commitSha ?? null,
          body.externalId ?? null,
          body.score ?? null,
          body.kept == null ? null : body.kept ? 1 : 0,
          body.artifactRef ?? null,
          body.error ?? null,
          now,
          now,
        )
        .run();
    },

    async getAutoTrial(id) {
      await ensureAutoSchema(db);
      const r = await db.prepare("SELECT * FROM auto_trials WHERE id = ?").bind(id).first();
      return r ? rowToTrial(r as Record<string, unknown>) : null;
    },

    async listAutoTrials(autoRunId) {
      await ensureAutoSchema(db);
      const { results } = await db
        .prepare("SELECT * FROM auto_trials WHERE auto_run_id = ? ORDER BY created_at ASC")
        .bind(autoRunId)
        .all();
      return (results ?? []).map((r) => rowToTrial(r as Record<string, unknown>));
    },

    async claimPendingTrial(_runnerId) {
      await ensureAutoSchema(db);
      const r = await db
        .prepare("SELECT * FROM auto_trials WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
        .first();
      if (!r) return null;
      const trial = rowToTrial(r as Record<string, unknown>);
      const now = Date.now();
      await db
        .prepare("UPDATE auto_trials SET status='claimed', updated_at=? WHERE id=? AND status='pending'")
        .bind(now, trial.id)
        .run();
      return { ...trial, status: "claimed" as const, updatedAt: now };
    },

    async upsertAutoRunner(body) {
      await ensureAutoSchema(db);
      const existing = await db.prepare("SELECT * FROM auto_runners WHERE id = ?").bind(body.id).first();
      const now = Date.now();
      if (existing) {
        await db
          .prepare(
            `UPDATE auto_runners SET name=COALESCE(?, name), capacity=COALESCE(?, capacity), last_heartbeat_at=? WHERE id=?`,
          )
          .bind(body.name ?? null, body.capacity ?? null, body.lastHeartbeatAt ?? now, body.id)
          .run();
        const updated = await db.prepare("SELECT * FROM auto_runners WHERE id = ?").bind(body.id).first();
        return rowToRunner(updated as Record<string, unknown>);
      }
      if (!body.ownerId || !body.name || !body.tokenHash) {
        throw new Error("create AutoRunner requires ownerId, name, tokenHash");
      }
      await db
        .prepare(
          `INSERT INTO auto_runners (id, owner_id, name, token_hash, capacity, last_heartbeat_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          body.id,
          body.ownerId,
          body.name,
          body.tokenHash,
          body.capacity ?? null,
          now,
          now,
        )
        .run();
      return {
        id: body.id,
        ownerId: body.ownerId,
        name: body.name,
        tokenHash: body.tokenHash,
        capacity: body.capacity,
        lastHeartbeatAt: now,
        createdAt: now,
      };
    },

    async getAutoRunnerByTokenHash(tokenHash) {
      await ensureAutoSchema(db);
      const r = await db
        .prepare("SELECT * FROM auto_runners WHERE token_hash = ?")
        .bind(tokenHash)
        .first();
      return r ? rowToRunner(r as Record<string, unknown>) : null;
    },

    async listAutoRunners(ownerId) {
      await ensureAutoSchema(db);
      const { results } = await db
        .prepare("SELECT * FROM auto_runners WHERE owner_id = ? ORDER BY created_at DESC")
        .bind(ownerId)
        .all();
      return (results ?? []).map((r) => rowToRunner(r as Record<string, unknown>));
    },
  };
}

function createConvexAutoStore(baseUrl: string, serviceKey: string): AutoStore {
  const headers = {
    "content-type": "application/json",
    "x-service-key": serviceKey,
  };
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Convex ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  return {
    async upsertAutoRun(body) {
      await post("/api/auto/runs/upsert", {
        autoRunId: body.id,
        datasetId: body.datasetId,
        ownerId: body.ownerId,
        status: body.status,
        repo: body.repo,
        protocol: body.protocol,
        box: body.box,
        compute: body.compute,
        progress: body.progress,
        resultRef: body.resultRef,
        error: body.error,
      });
    },
    getAutoRun: (id) => post("/api/auto/runs/get", { id }),
    listAutoRuns: (datasetId) => post("/api/auto/runs/list", { datasetId }),
    async upsertAutoTrial(body) {
      await post("/api/auto/trials/upsert", {
        trialId: body.id,
        autoRunId: body.autoRunId,
        status: body.status,
        hypothesis: body.hypothesis,
        commitSha: body.commitSha,
        externalId: body.externalId,
        score: body.score,
        kept: body.kept,
        artifactRef: body.artifactRef,
        error: body.error,
      });
    },
    getAutoTrial: (id) => post("/api/auto/trials/get", { id }),
    listAutoTrials: (autoRunId) => post("/api/auto/trials/list", { autoRunId }),
    claimPendingTrial: (runnerId) => post("/api/auto/trials/claim", { runnerId }),
    async upsertAutoRunner(body) {
      return post("/api/auto/runners/upsert", {
        runnerId: body.id,
        ownerId: body.ownerId,
        name: body.name,
        tokenHash: body.tokenHash,
        capacity: body.capacity,
        lastHeartbeatAt: body.lastHeartbeatAt,
      });
    },
    getAutoRunnerByTokenHash: (tokenHash) =>
      post("/api/auto/runners/by-token", { tokenHash }),
    listAutoRunners: (ownerId) => post("/api/auto/runners/list", { ownerId }),
  };
}

export function createAutoStore(env: {
  DB?: D1Database;
  CONVEX_URL?: string;
  CONVEX_SERVICE_KEY?: string;
}): AutoStore {
  if (env.DB) return createD1AutoStore(env.DB);
  if (!env.CONVEX_URL || !env.CONVEX_SERVICE_KEY) {
    throw new Error("Configure DB (D1) or CONVEX_URL + CONVEX_SERVICE_KEY");
  }
  return createConvexAutoStore(env.CONVEX_URL, env.CONVEX_SERVICE_KEY);
}
