/** AutoRun lifecycle — create, provision Box, trials, runners. */

import type {
  AutoActivity,
  AutoComputeConfig,
  AutoMessage,
  AutoProtocol,
  AutoRun,
  AutoTrial,
  BindAutoDatasetRequest,
  CompleteAutoTrialRequest,
  CreateAutoRunRequest,
  RegisterRunnerRequest,
  RegisterRunnerResponse,
  ReportAutoInstructionsRequest,
} from "@trainfabric/shared";
import type { AutoStore } from "./autoStore";
import type { BoxClient } from "./box";
import { resolveComputeProvider } from "./computeProviders";

function randomId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${hex}`;
}

/** Append a timeline entry (best-effort — never blocks the lifecycle). */
export async function logActivity(
  store: AutoStore,
  autoRunId: string,
  kind: AutoActivity["kind"],
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await store.appendActivity({ id: randomId("act"), autoRunId, kind, message, meta });
  } catch {
    /* activity is non-critical */
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validateProtocol(p: AutoProtocol): void {
  // snapshotId is bound when the agent picks a dataset — not required at create.
  if (!p.metric?.name) throw new Error("protocol.metric.name required");
  if (p.metric.direction !== "min" && p.metric.direction !== "max") {
    throw new Error("protocol.metric.direction must be min|max");
  }
  if (!p.budget?.maxTrials || p.budget.maxTrials < 1) {
    throw new Error("protocol.budget.maxTrials must be >= 1");
  }
  if (!p.budget.maxWallClockSec || p.budget.maxWallClockSec < 1) {
    throw new Error("protocol.budget.maxWallClockSec must be >= 1");
  }
  if (!Array.isArray(p.mutablePaths) || p.mutablePaths.length === 0) {
    throw new Error("protocol.mutablePaths required");
  }
  if (!Array.isArray(p.immutablePaths)) {
    throw new Error("protocol.immutablePaths required");
  }
}

export async function createAutoRun(opts: {
  store: AutoStore;
  box: BoxClient | null;
  /** Optional starting-dataset hint; the agent may discover + bind others. */
  datasetId?: string;
  ownerId: string;
  body: CreateAutoRunRequest;
  tfApiUrl: string;
  campaignToken: string;
  env: {
    MODAL_TOKEN?: string;
    MODAL_APP_REF?: string;
    MODAL_API_BASE?: string;
    BOX_TEMPLATE_ID?: string;
  };
}): Promise<AutoRun> {
  validateProtocol(opts.body.protocol);
  if (!opts.body.repoUrl) throw new Error("repoUrl required");
  const compute: AutoComputeConfig = opts.body.compute;
  if (compute.provider !== "modal" && compute.provider !== "runner") {
    throw new Error("compute.provider must be modal|runner");
  }

  const datasetId = opts.datasetId ?? opts.body.datasetId;
  // Goal is optional at create — prefer loading from the connected repo after clone.
  const goal = opts.body.goal;

  const id = randomId("auto");
  const now = Date.now();
  const run: AutoRun = {
    id,
    datasetId,
    boundDatasets: datasetId ? [datasetId] : [],
    goal,
    ownerId: opts.ownerId,
    status: "provisioning",
    repo: {
      url: opts.body.repoUrl,
      defaultBranch: opts.body.defaultBranch ?? "main",
    },
    protocol: opts.body.protocol,
    box: { templateId: opts.body.templateId || opts.env.BOX_TEMPLATE_ID },
    compute,
    progress: { trial: 0, updatedAt: now },
    createdAt: now,
    updatedAt: now,
  };

  await opts.store.upsertAutoRun(run);
  await logActivity(opts.store, id, "status", "Campaign created", {
    goal,
    datasetId,
    repo: run.repo.url,
  });

  try {
    if (opts.box) {
      const provisioned = await opts.box.provisionAutoRun({
        templateId: run.box.templateId,
        repoUrl: run.repo.url,
        env: {
          AUTORUN_ID: id,
          TF_API_URL: opts.tfApiUrl,
          TF_TOKEN: opts.campaignToken,
          TF_DATASET_ID: datasetId ?? "",
          AUTORUN_GOAL: goal ?? "",
          PROTOCOL_JSON: JSON.stringify(run.protocol),
          REPO_URL: run.repo.url,
          REPO_BRANCH: run.repo.defaultBranch,
          COMPUTE_PROVIDER: compute.provider,
          MODAL_REF: compute.modalRef ?? "",
          RUNNER_ID: compute.runnerId ?? "",
        },
      });
      run.box = {
        ...run.box,
        boxId: provisioned.boxId,
        desktopUrl: provisioned.desktopUrl,
        daemonHostUrl: provisioned.daemonHostUrl,
      };
      await logActivity(opts.store, id, "box", "Box sandbox provisioned", {
        boxId: provisioned.boxId,
      });
    } else {
      // Stub mode — AutoRun tracks without Box (local/dev)
      run.box = { ...run.box, boxId: `stub_${id}` };
      await logActivity(opts.store, id, "box", "Stub mode (no BOX_API_KEY on Worker)");
    }
    // Goal-first with no dataset yet → wait for the agent to bind one.
    run.status = datasetId ? "running" : "awaiting_user";
    run.updatedAt = Date.now();
    await opts.store.upsertAutoRun(run);
    await logActivity(
      opts.store,
      id,
      "status",
      datasetId
        ? "Running — agent starting trials"
        : "Awaiting dataset — agent will load the repo brief and discover candidates",
    );
  } catch (e) {
    run.status = "error";
    run.error = e instanceof Error ? e.message : String(e);
    run.updatedAt = Date.now();
    await opts.store.upsertAutoRun(run);
    await logActivity(opts.store, id, "status", `Provisioning failed: ${run.error}`);
  }

  return run;
}

/**
 * Persist the research brief the daemon loaded from the connected repo
 * (TRAINFABRIC.md / AGENTS.md / README.md). Surfaces on the monitor header.
 */
export async function reportInstructions(opts: {
  store: AutoStore;
  run: AutoRun;
  body: ReportAutoInstructionsRequest;
}): Promise<AutoRun> {
  const content = opts.body.content.trim();
  if (!content) throw new Error("content required");
  const next: AutoRun = {
    ...opts.run,
    goal: content.slice(0, 4000),
    updatedAt: Date.now(),
  };
  await opts.store.upsertAutoRun(next);
  await logActivity(
    opts.store,
    next.id,
    "note",
    `Loaded instructions from ${opts.body.sourceFile ?? "repo"}`,
    { sourceFile: opts.body.sourceFile, chars: content.length },
  );
  await opts.store.appendMessage({
    id: randomId("msg"),
    autoRunId: next.id,
    role: "assistant",
    source: "daemon",
    content: `Loaded research brief from ${opts.body.sourceFile ?? "repo"}:\n\n${content.slice(0, 1500)}`,
    createdAt: Date.now(),
    meta: { sourceFile: opts.body.sourceFile },
  });
  return next;
}

/**
 * Bind a dataset the agent discovered (or the user confirmed). The first bind
 * freezes the protocol snapshot so all trials stay comparable. Moves an
 * `awaiting_user` run into `running`.
 */
export async function bindDataset(opts: {
  store: AutoStore;
  run: AutoRun;
  body: BindAutoDatasetRequest;
  boundBy: "agent" | "user";
}): Promise<AutoRun> {
  const { run, body } = opts;
  if (!body.datasetId) throw new Error("datasetId required");

  const bound = new Set(run.boundDatasets ?? []);
  bound.add(body.datasetId);

  const protocol: AutoProtocol = { ...run.protocol };
  if (!protocol.snapshotId && body.snapshotId) protocol.snapshotId = body.snapshotId;

  const next: AutoRun = {
    ...run,
    datasetId: run.datasetId || body.datasetId,
    boundDatasets: [...bound],
    protocol,
    status: run.status === "awaiting_user" ? "running" : run.status,
    updatedAt: Date.now(),
  };
  await opts.store.upsertAutoRun(next);
  await logActivity(opts.store, run.id, "dataset_bound", `Bound dataset ${body.datasetId}`, {
    datasetId: body.datasetId,
    snapshotId: protocol.snapshotId,
    reason: body.reason,
    boundBy: opts.boundBy,
  });
  return next;
}

export async function pauseAutoRun(
  store: AutoStore,
  box: BoxClient | null,
  run: AutoRun,
): Promise<AutoRun> {
  if (run.status !== "running") throw new Error(`cannot pause from ${run.status}`);
  if (box && run.box.boxId && !run.box.boxId.startsWith("stub_")) {
    await box.interrupt(run.box.boxId).catch(() => undefined);
    await box.stop(run.box.boxId);
  }
  const next = { ...run, status: "paused" as const, updatedAt: Date.now() };
  await store.upsertAutoRun(next);
  await logActivity(store, run.id, "status", "Paused");
  return next;
}

export async function resumeAutoRun(
  store: AutoStore,
  box: BoxClient | null,
  run: AutoRun,
): Promise<AutoRun> {
  if (run.status !== "paused") throw new Error(`cannot resume from ${run.status}`);
  if (box && run.box.boxId && !run.box.boxId.startsWith("stub_")) {
    await box.resume(run.box.boxId, { noEnv: true });
    await box
      .command(
        run.box.boxId,
        "systemctl --user start trainfabric-autorunner 2>/dev/null || nohup python3 ~/trainfabric/autorunner_daemon.py >/tmp/autorunner.log 2>&1 &",
      )
      .catch(() => undefined);
  }
  const next = { ...run, status: "running" as const, updatedAt: Date.now() };
  await store.upsertAutoRun(next);
  await logActivity(store, run.id, "status", "Resumed");
  return next;
}

export async function cancelAutoRun(
  store: AutoStore,
  box: BoxClient | null,
  run: AutoRun,
): Promise<AutoRun> {
  if (run.status === "done" || run.status === "cancelled") return run;
  if (box && run.box.boxId && !run.box.boxId.startsWith("stub_")) {
    await box.interrupt(run.box.boxId).catch(() => undefined);
    await box.stop(run.box.boxId).catch(() => undefined);
  }
  const next = { ...run, status: "cancelled" as const, updatedAt: Date.now() };
  await store.upsertAutoRun(next);
  await logActivity(store, run.id, "status", "Cancelled");
  return next;
}

export async function enqueueTrial(opts: {
  store: AutoStore;
  run: AutoRun;
  hypothesis?: string;
  commitSha?: string;
  callbackBaseUrl: string;
  env: { MODAL_TOKEN?: string; MODAL_APP_REF?: string; MODAL_API_BASE?: string };
}): Promise<AutoTrial> {
  const trialId = randomId("trial");
  const trial: AutoTrial = {
    id: trialId,
    autoRunId: opts.run.id,
    status: "pending",
    hypothesis: opts.hypothesis,
    commitSha: opts.commitSha,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await opts.store.upsertAutoTrial(trial);

  const provider = resolveComputeProvider(opts.run.compute, opts.env);
  const { externalId } = await provider.submitTrial({
    trialId,
    autoRunId: opts.run.id,
    repoUrl: opts.run.repo.url,
    commitSha: opts.commitSha,
    budgetSec: Math.min(opts.run.protocol.budget.maxWallClockSec, 3600),
    callbackUrl: `${opts.callbackBaseUrl}/auto/${opts.run.id}/trials/${trialId}/complete`,
  });

  // Modal web endpoints often complete (via callback) before submitTrial returns.
  // Don't clobber a terminal status that the callback already wrote.
  const after = await opts.store.getAutoTrial(trialId);
  if (
    after &&
    (after.status === "done" || after.status === "error" || after.status === "cancelled")
  ) {
    const withExt =
      after.externalId === externalId
        ? after
        : { ...after, externalId, updatedAt: Date.now() };
    if (withExt !== after) await opts.store.upsertAutoTrial(withExt);
    await logActivity(opts.store, opts.run.id, "trial", `Trial enqueued (${opts.run.compute.provider})`, {
      trialId,
      hypothesis: opts.hypothesis,
      commitSha: opts.commitSha,
    });
    return withExt;
  }

  const running: AutoTrial = {
    ...trial,
    status: opts.run.compute.provider === "runner" ? "pending" : "running",
    externalId,
    updatedAt: Date.now(),
  };
  await opts.store.upsertAutoTrial(running);
  await logActivity(opts.store, opts.run.id, "trial", `Trial enqueued (${opts.run.compute.provider})`, {
    trialId,
    hypothesis: opts.hypothesis,
    commitSha: opts.commitSha,
  });
  return running;
}

export async function completeTrial(opts: {
  store: AutoStore;
  run: AutoRun;
  trial: AutoTrial;
  body: CompleteAutoTrialRequest;
}): Promise<{ trial: AutoTrial; run: AutoRun }> {
  const score = opts.body.score;
  const direction = opts.run.protocol.metric.direction;
  const best = opts.run.progress.bestScore;
  let kept = opts.body.kept;
  if (kept === undefined && score !== undefined && opts.body.status === "done") {
    if (best === undefined) kept = true;
    else kept = direction === "min" ? score < best : score > best;
  }

  const trial: AutoTrial = {
    ...opts.trial,
    status: opts.body.status,
    score,
    kept,
    artifactRef: opts.body.artifactRef,
    error: opts.body.error,
    commitSha: opts.body.commitSha ?? opts.trial.commitSha,
    updatedAt: Date.now(),
  };
  await opts.store.upsertAutoTrial(trial);

  const progress = { ...opts.run.progress, trial: opts.run.progress.trial + 1, updatedAt: Date.now() };
  if (kept && score !== undefined) {
    progress.bestScore = score;
    if (trial.commitSha) progress.lastCommitSha = trial.commitSha;
  }

  let status = opts.run.status;
  if (progress.trial >= opts.run.protocol.budget.maxTrials) status = "done";

  const run: AutoRun = {
    ...opts.run,
    status,
    progress,
    updatedAt: Date.now(),
  };
  await opts.store.upsertAutoRun(run);
  await logActivity(
    opts.store,
    run.id,
    "trial",
    `Trial ${opts.body.status}${score !== undefined ? ` · score ${score}` : ""}${kept ? " · kept" : ""}`,
    { trialId: trial.id, score, kept, commitSha: trial.commitSha },
  );
  if (status === "done") {
    await logActivity(opts.store, run.id, "status", "Campaign complete — trial budget reached");
  }
  return { trial, run };
}

/** Deliver a steer instruction to the running Box agent for this AutoRun only. */
async function injectInstruction(
  box: BoxClient | null,
  run: AutoRun,
  content: string,
): Promise<{ delivered: boolean; agentReply?: string }> {
  const boxId = run.box.boxId;
  if (!box || !boxId || boxId.startsWith("stub_")) {
    return { delivered: false };
  }
  // Preferred: daemon HTTP chat on this run's hosted URL (bound at provision).
  if (run.box.daemonHostUrl) {
    try {
      const res = await fetch(`${run.box.daemonHostUrl.replace(/\/$/, "")}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, autoRunId: run.id }),
      });
      if (res.ok) {
        let agentReply: string | undefined;
        try {
          const json = (await res.json()) as { reply?: string; message?: string };
          agentReply = (json.reply || json.message || "").trim() || undefined;
        } catch {
          /* non-JSON body is still a successful delivery */
        }
        return { delivered: true, agentReply };
      }
    } catch {
      /* fall through to file drop */
    }
  }
  // Fallback: drop the steer into the daemon inbox the loop polls.
  try {
    const safe = content.replace(/'/g, "'\\''");
    await box.command(
      boxId,
      `mkdir -p ~/trainfabric/inbox && printf '%s\\n' '${safe}' >> ~/trainfabric/inbox/steer.log`,
    );
    return { delivered: true };
  } catch {
    return { delivered: false };
  }
}

function summarizeRun(run: AutoRun): string {
  const p = run.progress;
  const metric = run.protocol.metric;
  const parts = [
    `status: ${run.status}`,
    `trial ${p.trial}/${run.protocol.budget.maxTrials}`,
  ];
  if (p.bestScore != null) parts.push(`best ${metric.name} ${p.bestScore}`);
  if (run.datasetId) parts.push(`dataset ${run.datasetId}`);
  else parts.push("no dataset bound yet");
  return parts.join(" · ");
}

/**
 * Shared AutoRun thread.
 * - User/dashboard/MCP messages → routed to that run's Box sandbox; assistant
 *   reply prefers the daemon's /chat response (real talk-back).
 * - Daemon/assistant messages → stored only (no re-inject, no fake copilot).
 */
export async function postAutoMessage(opts: {
  store: AutoStore;
  box: BoxClient | null;
  run: AutoRun;
  content: string;
  role?: AutoMessage["role"];
  source: AutoMessage["source"];
  meta?: Record<string, unknown>;
  ai?: unknown;
}): Promise<{ userMessage: AutoMessage; assistantMessage: AutoMessage | null }> {
  const content = opts.content.trim();
  if (!content) throw new Error("content required");

  const role = opts.role ?? "user";
  const fromAgent =
    opts.source === "daemon" || role === "assistant" || role === "system" || role === "tool";

  // Agent talk-back: persist only. Do not inject back into Box or invent replies.
  if (fromAgent) {
    const userMessage = await opts.store.appendMessage({
      id: randomId("msg"),
      autoRunId: opts.run.id,
      role,
      source: opts.source,
      content,
      meta: opts.meta,
    });
    await logActivity(opts.store, opts.run.id, "message", `agent → ${opts.source}`, {
      preview: content.slice(0, 140),
    });
    return { userMessage, assistantMessage: null };
  }

  const userMessage = await opts.store.appendMessage({
    id: randomId("msg"),
    autoRunId: opts.run.id,
    role: "user",
    source: opts.source,
    content,
    meta: opts.meta,
  });
  await logActivity(opts.store, opts.run.id, "message", `${opts.source} → agent`, {
    preview: content.slice(0, 140),
    boxId: opts.run.box.boxId,
  });

  const { delivered, agentReply } = await injectInstruction(opts.box, opts.run, content);

  let reply = (agentReply || "").trim();
  if (!reply) {
    reply = delivered
      ? `Delivered to Box ${opts.run.box.boxId ?? "sandbox"}. ${summarizeRun(opts.run)}. The agent will acknowledge on its next loop.`
      : `Queued for when the agent reconnects. ${summarizeRun(opts.run)}.`;
  }

  const assistantMessage = await opts.store.appendMessage({
    id: randomId("msg"),
    autoRunId: opts.run.id,
    role: "assistant",
    source: agentReply ? "daemon" : "api",
    content: reply,
    meta: { delivered, boxId: opts.run.box.boxId, via: agentReply ? "box-chat" : "ack" },
  });

  return { userMessage, assistantMessage };
}

/** Daemon heartbeat — sandbox volunteers liveness (not polled by a cron). */
export async function heartbeatAutoRun(opts: {
  store: AutoStore;
  run: AutoRun;
  body: { phase?: string; message?: string; trial?: number; meta?: Record<string, unknown> };
}): Promise<AutoRun> {
  const now = Date.now();
  const progress = {
    ...opts.run.progress,
    updatedAt: now,
    ...(typeof opts.body.trial === "number" ? { trial: opts.body.trial } : {}),
  };
  const next: AutoRun = {
    ...opts.run,
    progress,
    updatedAt: now,
  };
  await opts.store.upsertAutoRun(next);
  if (opts.body.message || opts.body.phase) {
    await logActivity(
      opts.store,
      next.id,
      "status",
      opts.body.message || `Agent heartbeat — ${opts.body.phase}`,
      { phase: opts.body.phase, ...(opts.body.meta || {}) },
    );
  }
  return next;
}

export async function registerRunner(opts: {
  store: AutoStore;
  ownerId: string;
  body: RegisterRunnerRequest;
}): Promise<RegisterRunnerResponse> {
  const runnerId = randomId("runner");
  const token = `tfr_${crypto.randomUUID().replace(/-/g, "")}`;
  const tokenHash = await sha256Hex(token);
  await opts.store.upsertAutoRunner({
    id: runnerId,
    ownerId: opts.ownerId,
    name: opts.body.name || "gpu-runner",
    tokenHash,
    capacity: opts.body.capacity,
  });
  return { runnerId, token };
}

export async function authRunner(
  store: AutoStore,
  bearerToken: string | undefined,
): Promise<{ id: string; ownerId: string } | null> {
  if (!bearerToken) return null;
  const raw = bearerToken.replace(/^Bearer\s+/i, "").trim();
  if (!raw) return null;
  const tokenHash = await sha256Hex(raw);
  const runner = await store.getAutoRunnerByTokenHash(tokenHash);
  if (!runner) return null;
  await store.upsertAutoRunner({
    id: runner.id,
    lastHeartbeatAt: Date.now(),
  });
  return { id: runner.id, ownerId: runner.ownerId };
}
