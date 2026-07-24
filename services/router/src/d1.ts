import type { CostTier, SavedQuery, Visibility } from "@trainfabric/shared";

/** D1-backed control plane (replaces Convex HTTP for Cloudflare deploy). */

export interface D1Dataset {
  id: string;
  owner: string;
  visibility: "public" | "private";
  name: string;
  description?: string;
  tags: string[];
  stars: number;
  latestSnapshotId: string;
  rowCount: number;
  sizeBytes: number;
  kind: "base" | "derived";
  schema?: unknown;
  derivedSpec?: unknown;
  materializationDecision?: unknown;
  stale?: boolean;
  staleReason?: string;
  icebergNamespace?: string;
  icebergTable?: string;
  createdAt: number;
  updatedAt: number;
}

export async function ensureSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        visibility TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        stars INTEGER NOT NULL DEFAULT 0,
        latest_snapshot_id TEXT NOT NULL DEFAULT '',
        row_count INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'base',
        schema_json TEXT,
        derived_spec TEXT,
        materialization_decision TEXT,
        stale INTEGER DEFAULT 0,
        stale_reason TEXT,
        iceberg_namespace TEXT,
        iceberg_table TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
    )
    .run();
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS result_cache (
        query_hash TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        r2_url TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
    )
    .run();
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        result_ref TEXT,
        error TEXT,
        progress INTEGER,
        updated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
    )
    .run();
    await db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS queries (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          dataset_id TEXT NOT NULL,
          name TEXT NOT NULL,
          visibility TEXT NOT NULL DEFAULT 'private',
          columns_json TEXT,
          filter TEXT,
          snapshot_id TEXT,
          branch TEXT DEFAULT 'main',
          limit_n INTEGER,
          query_hash TEXT NOT NULL,
          r2_url TEXT,
          cost_tier TEXT,
          row_count INTEGER,
          size_bytes INTEGER,
          last_run_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `,
      )
      .run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_queries_dataset ON queries(dataset_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_queries_owner ON queries(owner)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_queries_visibility ON queries(visibility)`).run();
}

function rowToQuery(r: Record<string, unknown>): SavedQuery {
  return {
    id: String(r.id),
    owner: String(r.owner),
    datasetId: String(r.dataset_id),
    name: String(r.name),
    visibility: r.visibility as Visibility,
    columns: r.columns_json ? JSON.parse(String(r.columns_json)) : undefined,
    filter: r.filter ? String(r.filter) : undefined,
    snapshotId: r.snapshot_id ? String(r.snapshot_id) : undefined,
    branch: r.branch ? String(r.branch) : undefined,
    limit: r.limit_n != null ? Number(r.limit_n) : undefined,
    queryHash: String(r.query_hash),
    r2Url: r.r2_url ? String(r.r2_url) : undefined,
    costTier: r.cost_tier ? (r.cost_tier as CostTier) : undefined,
    rowCount: r.row_count != null ? Number(r.row_count) : undefined,
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : undefined,
    lastRunAt: Number(r.last_run_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function rowToDataset(r: Record<string, unknown>): D1Dataset {
  return {
    id: String(r.id),
    owner: String(r.owner),
    visibility: r.visibility as "public" | "private",
    name: String(r.name),
    description: r.description ? String(r.description) : undefined,
    tags: JSON.parse(String(r.tags || "[]")),
    stars: Number(r.stars || 0),
    latestSnapshotId: String(r.latest_snapshot_id || ""),
    rowCount: Number(r.row_count || 0),
    sizeBytes: Number(r.size_bytes || 0),
    kind: (r.kind as "base" | "derived") || "base",
    schema: r.schema_json ? JSON.parse(String(r.schema_json)) : undefined,
    derivedSpec: r.derived_spec ? JSON.parse(String(r.derived_spec)) : undefined,
    materializationDecision: r.materialization_decision
      ? JSON.parse(String(r.materialization_decision))
      : undefined,
    stale: Boolean(r.stale),
    staleReason: r.stale_reason ? String(r.stale_reason) : undefined,
    icebergNamespace: r.iceberg_namespace ? String(r.iceberg_namespace) : undefined,
    icebergTable: r.iceberg_table ? String(r.iceberg_table) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function createD1Registry(db: D1Database) {
  return {
    async listDatasets(opts: {
      search?: string;
      tag?: string;
      owner?: string;
      includePrivateFor?: string;
      limit?: number;
    }) {
      await ensureSchema(db);
      const lim = opts.limit ?? 50;
      const { results } = await db.prepare("SELECT * FROM datasets ORDER BY updated_at DESC LIMIT ?")
        .bind(200)
        .all();
      let rows = (results as Record<string, unknown>[]).map(rowToDataset);
      rows = rows.filter((d) => {
        if (d.visibility === "public") return true;
        return opts.includePrivateFor && d.owner === opts.includePrivateFor;
      });
      if (opts.owner && opts.owner !== "me") rows = rows.filter((d) => d.owner === opts.owner);
      if (opts.tag) {
        const t = opts.tag.toLowerCase();
        rows = rows.filter((d) => d.tags.some((x) => x.toLowerCase() === t));
      }
      if (opts.search) {
        const s = opts.search.toLowerCase();
        rows = rows.filter(
          (d) =>
            d.name.toLowerCase().includes(s) ||
            d.description?.toLowerCase().includes(s) ||
            d.tags.some((x) => x.toLowerCase().includes(s)),
        );
      }
      return rows.slice(0, lim);
    },

    async getDataset(id: string) {
      await ensureSchema(db);
      const r = await db.prepare("SELECT * FROM datasets WHERE id = ?").bind(id).first();
      return r ? rowToDataset(r as Record<string, unknown>) : null;
    },

    async createDataset(body: {
      datasetId: string;
      owner: string;
      visibility: string;
      name: string;
      description?: string;
      tags: string[];
      kind?: string;
      derivedSpec?: unknown;
      materializationDecision?: unknown;
    }) {
      await ensureSchema(db);
      const now = Date.now();
      await db
        .prepare(
          `INSERT OR REPLACE INTO datasets
          (id, owner, visibility, name, description, tags, stars, latest_snapshot_id, row_count, size_bytes, kind, derived_spec, materialization_decision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, '', 0, 0, ?, ?, ?, ?, ?)`,
        )
        .bind(
          body.datasetId,
          body.owner,
          body.visibility,
          body.name,
          body.description ?? null,
          JSON.stringify(body.tags ?? []),
          body.kind ?? "base",
          body.derivedSpec ? JSON.stringify(body.derivedSpec) : null,
          body.materializationDecision ? JSON.stringify(body.materializationDecision) : null,
          now,
          now,
        )
        .run();
    },

    async updateAfterIngest(body: {
      datasetId: string;
      snapshotId: string;
      rowCount: number;
      sizeBytes: number;
      schema: unknown;
      icebergNamespace?: string;
      icebergTable?: string;
    }) {
      await ensureSchema(db);
      await db
        .prepare(
          `UPDATE datasets SET latest_snapshot_id=?, row_count=?, size_bytes=?, schema_json=?,
           iceberg_namespace=?, iceberg_table=?, updated_at=? WHERE id=?`,
        )
        .bind(
          body.snapshotId,
          body.rowCount,
          body.sizeBytes,
          JSON.stringify(body.schema),
          body.icebergNamespace ?? null,
          body.icebergTable ?? null,
          Date.now(),
          body.datasetId,
        )
        .run();
    },

    async lookupCache(queryHash: string) {
      await ensureSchema(db);
      const r = await db
        .prepare("SELECT * FROM result_cache WHERE query_hash = ?")
        .bind(queryHash)
        .first();
      if (!r) return null;
      return {
        queryHash: String(r.query_hash),
        datasetId: String(r.dataset_id),
        snapshotId: String(r.snapshot_id),
        r2Url: String(r.r2_url),
        rowCount: Number(r.row_count),
        sizeBytes: Number(r.size_bytes),
        createdAt: Number(r.created_at),
      };
    },

    async upsertCache(entry: {
      queryHash: string;
      datasetId: string;
      snapshotId: string;
      r2Url: string;
      rowCount: number;
      sizeBytes: number;
    }) {
      await ensureSchema(db);
      await db
        .prepare(
          `INSERT OR REPLACE INTO result_cache
          (query_hash, dataset_id, snapshot_id, r2_url, row_count, size_bytes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          entry.queryHash,
          entry.datasetId,
          entry.snapshotId,
          entry.r2Url,
          entry.rowCount,
          entry.sizeBytes,
          Date.now(),
        )
        .run();
    },

    async setJob(body: {
      jobId: string;
      datasetId?: string;
      kind?: string;
      status: string;
      resultRef?: string;
      error?: string;
      progress?: number;
    }) {
      await ensureSchema(db);
      const existing = await db
        .prepare("SELECT * FROM jobs WHERE job_id = ?")
        .bind(body.jobId)
        .first();
      const now = Date.now();
      if (existing) {
        await db
          .prepare(
            `UPDATE jobs SET status=?, result_ref=COALESCE(?, result_ref), error=?, progress=?, updated_at=? WHERE job_id=?`,
          )
          .bind(
            body.status,
            body.resultRef ?? null,
            body.error ?? null,
            body.progress ?? null,
            now,
            body.jobId,
          )
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO jobs (job_id, dataset_id, kind, status, result_ref, error, progress, updated_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            body.jobId,
            body.datasetId ?? "",
            body.kind ?? "ingest",
            body.status,
            body.resultRef ?? null,
            body.error ?? null,
            body.progress ?? null,
            now,
            now,
          )
          .run();
      }
    },

    async getJob(id: string) {
      await ensureSchema(db);
      const r = await db.prepare("SELECT * FROM jobs WHERE job_id = ?").bind(id).first();
      if (!r) return null;
      return {
        jobId: r.job_id,
        datasetId: r.dataset_id,
        kind: r.kind,
        status: r.status,
        resultRef: r.result_ref,
        error: r.error,
        progress: r.progress,
        updatedAt: r.updated_at,
        createdAt: r.created_at,
      };
    },


    async upsertQuery(input: {
      owner: string;
      datasetId: string;
      name: string;
      visibility?: Visibility;
      columns?: string[];
      filter?: string;
      snapshotId?: string;
      branch?: string;
      limit?: number;
      queryHash: string;
      r2Url?: string;
      costTier?: CostTier;
      rowCount?: number;
      sizeBytes?: number;
    }): Promise<SavedQuery> {
      await ensureSchema(db);
      const existing = await db
        .prepare(
          `SELECT id, created_at FROM queries WHERE dataset_id = ? AND owner = ? AND query_hash = ?`,
        )
        .bind(input.datasetId, input.owner, input.queryHash)
        .first<{ id: string; created_at: number }>();
      const now = Date.now();
      const id = existing?.id ?? `q_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const createdAt = existing?.created_at ?? now;
      await db
        .prepare(
          `INSERT OR REPLACE INTO queries
          (id, owner, dataset_id, name, visibility, columns_json, filter, snapshot_id, branch, limit_n, query_hash, r2_url, cost_tier, row_count, size_bytes, last_run_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.owner,
          input.datasetId,
          input.name,
          input.visibility ?? "private",
          input.columns ? JSON.stringify(input.columns) : null,
          input.filter ?? null,
          input.snapshotId ?? null,
          input.branch ?? "main",
          input.limit ?? null,
          input.queryHash,
          input.r2Url ?? null,
          input.costTier ?? null,
          input.rowCount ?? null,
          input.sizeBytes ?? null,
          now,
          createdAt,
          now,
        )
        .run();
      const row = await db.prepare("SELECT * FROM queries WHERE id = ?").bind(id).first();
      return rowToQuery(row as Record<string, unknown>);
    },
    async listQueries(opts: {
      datasetId?: string;
      owner: string;
      includePublic?: boolean;
    }): Promise<SavedQuery[]> {
      await ensureSchema(db);
      let sql = "SELECT * FROM queries WHERE 1=1";
      const binds: unknown[] = [];
      if (opts.datasetId) {
        sql += " AND dataset_id = ?";
        binds.push(opts.datasetId);
      }
      if (opts.includePublic) {
        sql += " AND (owner = ? OR visibility = 'public')";
        binds.push(opts.owner);
      } else {
        sql += " AND owner = ?";
        binds.push(opts.owner);
      }
      sql += " ORDER BY last_run_at DESC";
      const rows = await db.prepare(sql).bind(...binds).all();
      return (rows.results ?? []).map((r) => rowToQuery(r as Record<string, unknown>));
    },
    async getQuery(id: string): Promise<SavedQuery | null> {
      await ensureSchema(db);
      const row = await db.prepare("SELECT * FROM queries WHERE id = ?").bind(id).first();
      return row ? rowToQuery(row as Record<string, unknown>) : null;
    },
    async setQueryVisibility(
      id: string,
      visibility: Visibility,
      owner: string,
    ): Promise<SavedQuery | null> {
      await ensureSchema(db);
      const existing = await db
        .prepare("SELECT id FROM queries WHERE id = ? AND owner = ?")
        .bind(id, owner)
        .first();
      if (!existing) return null;
      const now = Date.now();
      await db
        .prepare("UPDATE queries SET visibility = ?, updated_at = ? WHERE id = ?")
        .bind(visibility, now, id)
        .run();
      const row = await db.prepare("SELECT * FROM queries WHERE id = ?").bind(id).first();
      return row ? rowToQuery(row as Record<string, unknown>) : null;
    },
    async seedDemo() {
      await ensureSchema(db);
      const demos = [
        {
          id: "demo_nyc_taxi",
          name: "nyc-taxi-sample",
          description: "NYC yellow taxi trips sample — partitioned by pickup_date",
          tags: ["transport", "nyc", "taxi"],
          rowCount: 1000,
          sizeBytes: 120000,
          columns: [
            { name: "pickup_date", type: "date", nullable: false, isPartition: true },
            { name: "fare_amount", type: "double", nullable: false, isPartition: false, min: 0, max: 250 },
            { name: "passenger_count", type: "long", nullable: true, isPartition: false },
            { name: "trip_distance", type: "double", nullable: false, isPartition: false },
          ],
          sampleRows: [
            { pickup_date: "2024-01-01", fare_amount: 12.5, passenger_count: 1, trip_distance: 2.1 },
            { pickup_date: "2024-01-01", fare_amount: 28.0, passenger_count: 2, trip_distance: 5.4 },
            { pickup_date: "2024-01-02", fare_amount: 9.75, passenger_count: 1, trip_distance: 1.2 },
          ],
        },
        {
          id: "demo_sensors",
          name: "iot-sensors",
          description: "Synthetic IoT time-series",
          tags: ["iot", "timeseries"],
          rowCount: 5000,
          sizeBytes: 800000,
          columns: [
            { name: "device_id", type: "string", nullable: false, isPartition: true },
            { name: "ts", type: "timestamp", nullable: false, isPartition: true },
            { name: "temp_c", type: "double", nullable: false, isPartition: false },
            { name: "humidity", type: "double", nullable: true, isPartition: false },
          ],
          sampleRows: [
            { device_id: "dev-1", ts: "2024-06-01T00:00:00Z", temp_c: 22.1, humidity: 48.0 },
            { device_id: "dev-1", ts: "2024-06-01T00:05:00Z", temp_c: 22.3, humidity: 47.5 },
            { device_id: "dev-2", ts: "2024-06-01T00:00:00Z", temp_c: 19.8, humidity: 55.2 },
          ],
        },
      ];
      for (const d of demos) {
        const existing = await db.prepare("SELECT id FROM datasets WHERE id = ?").bind(d.id).first();
        if (existing) continue;
        const now = Date.now();
        const schema = {
          datasetId: d.id,
          snapshotId: `${d.id}_snap1`,
          columns: d.columns,
          rowCount: d.rowCount,
          sizeBytes: d.sizeBytes,
          partitionColumns: d.columns.filter((c) => c.isPartition).map((c) => c.name),
          sampleRows: d.sampleRows,
        };
        await db
          .prepare(
            `INSERT INTO datasets
            (id, owner, visibility, name, description, tags, stars, latest_snapshot_id, row_count, size_bytes, kind, schema_json, created_at, updated_at)
            VALUES (?, 'demo', 'public', ?, ?, ?, 3, ?, ?, ?, 'base', ?, ?, ?)`,
          )
          .bind(
            d.id,
            d.name,
            d.description,
            JSON.stringify(d.tags),
            `${d.id}_snap1`,
            d.rowCount,
            d.sizeBytes,
            JSON.stringify(schema),
            now,
            now,
          )
          .run();
      }
      // Seed a couple of community updates so Home isn't empty after seed.
      const social = await import("./social");
      const store = social.createD1SocialStore(db);
      const existingPost = await db.prepare("SELECT id FROM social_posts LIMIT 1").first();
      if (!existingPost) {
        await store.ensureConnection("demo", "demo_nyc_taxi", "manual");
        await store.createPost({
          authorId: "demo",
          authorName: "demo",
          datasetId: "demo_nyc_taxi",
          body: "Welcome — partition on pickup_date for free Case A slices. Try filter pickup_date = '2024-01-01'.",
          source: "user",
          datasetOwner: "demo",
          datasetName: "nyc-taxi-sample",
        });
        await store.createPost({
          authorId: "agent",
          authorName: "autoresearch",
          datasetId: "demo_sensors",
          body: "Finding: device_id + ts partitions keep most peeks Case A. Humidity nulls cluster on device_id=dev-2.",
          source: "agent",
          findings: { partition_hint: ["device_id", "ts"], note: "seed finding" },
          datasetOwner: "demo",
          datasetName: "iot-sensors",
        });
      }
    },
  };
}
