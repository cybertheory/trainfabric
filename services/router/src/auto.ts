/** AutoRun lifecycle — create, provision Box, trials, runners. */

import type {
  AutoComputeConfig,
  AutoProtocol,
  AutoRun,
  AutoTrial,
  CompleteAutoTrialRequest,
  CreateAutoRunRequest,
  RegisterRunnerRequest,
  RegisterRunnerResponse,
} from "@trainfabric/shared";
import type { AutoStore } from "./autoStore";
import type { BoxClient } from "./box";
import { resolveComputeProvider } from "./computeProviders";

function randomId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${hex}`;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validateProtocol(p: AutoProtocol): void {
  if (!p.snapshotId) throw new Error("protocol.snapshotId required");
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
  datasetId: string;
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

  const id = randomId("auto");
  const now = Date.now();
  const run: AutoRun = {
    id,
    datasetId: opts.datasetId,
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

  try {
    if (opts.box) {
      const provisioned = await opts.box.provisionAutoRun({
        templateId: run.box.templateId,
        repoUrl: run.repo.url,
        env: {
          AUTORUN_ID: id,
          TF_API_URL: opts.tfApiUrl,
          TF_TOKEN: opts.campaignToken,
          TF_DATASET_ID: opts.datasetId,
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
    } else {
      // Stub mode — AutoRun tracks without Box (local/dev)
      run.box = { ...run.box, boxId: `stub_${id}` };
    }
    run.status = "running";
    run.updatedAt = Date.now();
    await opts.store.upsertAutoRun(run);
  } catch (e) {
    run.status = "error";
    run.error = e instanceof Error ? e.message : String(e);
    run.updatedAt = Date.now();
    await opts.store.upsertAutoRun(run);
  }

  return run;
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

  const running: AutoTrial = {
    ...trial,
    status: opts.run.compute.provider === "runner" ? "pending" : "running",
    externalId,
    updatedAt: Date.now(),
  };
  await opts.store.upsertAutoTrial(running);
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
  return { trial, run };
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
