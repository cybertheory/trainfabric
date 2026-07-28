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
import { normalizeComputeProvider } from "@trainfabric/shared";
import type { AutoStore } from "./autoStore";
import type { ApiKeyStore } from "./apiKeys";
import type { BoxClient } from "./box";
import { BoxError } from "./box";
import { resolveComputeProvider } from "./computeProviders";

function randomId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${hex}`;
}

async function revokeCampaignApiKey(
  apiKeys: ApiKeyStore | null | undefined,
  run: AutoRun,
): Promise<void> {
  const keyId = run.box.campaignApiKeyId;
  if (!apiKeys || !keyId) return;
  try {
    await apiKeys.revokeTfApiKey(run.ownerId, keyId);
  } catch {
    /* best-effort */
  }
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

function resolveRepoBind(body: CreateAutoRunRequest): {
  url: string;
  defaultBranch: string;
  installationId?: number;
  fullName?: string;
  githubRepoId?: number;
  createdFromPlatform?: boolean;
} {
  const fullName = body.repoFullName?.replace(/\.git$/, "").replace(/^https?:\/\/(www\.)?github\.com\//, "");
  const urlFromName = fullName ? `https://github.com/${fullName}` : undefined;
  const url = (body.repoUrl || urlFromName || "").trim();
  if (!url) throw new Error("repoUrl or repoFullName required");
  const inferredFull =
    fullName ||
    url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "") ||
    undefined;
  return {
    url: url.replace(/\.git$/, ""),
    defaultBranch: body.defaultBranch ?? "main",
    installationId: body.installationId,
    fullName: inferredFull,
    githubRepoId: body.githubRepoId,
    createdFromPlatform: body.createdFromPlatform,
  };
}

export async function createAutoRun(opts: {
  store: AutoStore;
  box: BoxClient | null;
  /** Optional starting-dataset hint; the agent may discover + bind others. */
  datasetId?: string;
  ownerId: string;
  body: CreateAutoRunRequest;
  tfApiUrl: string;
  /**
   * Fallback TF_TOKEN when apiKeys is unavailable (e.g. local stub).
   * Prefer minting a durable tfak_* via apiKeys.
   */
  campaignToken?: string;
  /** Mint per-campaign tfak_* for the Box (recommended). */
  apiKeys?: ApiKeyStore | null;
  /** Short-lived GitHub App installation token for clone/push (not persisted). */
  githubToken?: string;
  env: {
    MODAL_TOKEN?: string;
    MODAL_APP_REF?: string;
    MODAL_API_BASE?: string;
    BOX_TEMPLATE_ID?: string;
    CF_ACCOUNT_ID?: string;
    CF_AI_GATEWAY_ID?: string;
    CF_AI_GATEWAY_TOKEN?: string;
    CF_AI_GATEWAY_BASE?: string;
    CF_AI_MODEL?: string;
  };
}): Promise<AutoRun> {
  validateProtocol(opts.body.protocol);
  const repoBind = resolveRepoBind(opts.body);
  const compute: AutoComputeConfig = {
    ...opts.body.compute,
    provider: normalizeComputeProvider(opts.body.compute.provider),
  };

  const fromBody = [
    ...(Array.isArray(opts.body.datasetIds) ? opts.body.datasetIds : []),
    opts.body.datasetId,
    opts.datasetId,
  ].filter((id): id is string => Boolean(id && String(id).trim()));
  const datasetIds = [...new Set(fromBody.map((id) => String(id).trim()))];
  const datasetId = datasetIds[0];
  // Goal is optional at create — prefer loading from the connected repo after clone.
  const goal = opts.body.goal;

  const id = randomId("auto");
  const now = Date.now();

  let tfToken = opts.campaignToken?.trim() || "";
  let campaignApiKeyId: string | undefined;
  if (opts.apiKeys) {
    const key = await opts.apiKeys.createTfApiKey({
      userId: opts.ownerId,
      name: `autorun:${id}`,
      scopes: ["trainfabric"],
    });
    tfToken = key.secret;
    campaignApiKeyId = key.id;
  }
  if (!tfToken) {
    throw new Error("campaign auth unavailable — configure D1 API keys or pass campaignToken");
  }

  const run: AutoRun = {
    id,
    datasetId,
    boundDatasets: datasetIds,
    goal,
    ownerId: opts.ownerId,
    status: "provisioning",
    repo: {
      url: repoBind.url,
      defaultBranch: repoBind.defaultBranch,
      installationId: repoBind.installationId,
      fullName: repoBind.fullName,
      githubRepoId: repoBind.githubRepoId,
      createdFromPlatform: repoBind.createdFromPlatform,
    },
    protocol: opts.body.protocol,
    box: {
      templateId: opts.body.templateId || opts.env.BOX_TEMPLATE_ID,
      campaignApiKeyId,
    },
    compute,
    progress: { trial: 0, updatedAt: now },
    createdAt: now,
    updatedAt: now,
  };

  await opts.store.upsertAutoRun(run);
  await logActivity(opts.store, id, "status", "Campaign created", {
    goal,
    datasetId,
    datasetIds,
    repo: run.repo.url,
    installationId: run.repo.installationId,
    campaignApiKeyId,
  });

  try {
    if (opts.box) {
      const provisioned = await opts.box.provisionAutoRun({
        templateId: run.box.templateId,
        repoUrl: run.repo.url,
        env: {
          AUTORUN_ID: id,
          TF_API_URL: opts.tfApiUrl,
          TF_TOKEN: tfToken,
          TF_DATASET_ID: datasetId ?? "",
          // Same names Hermes / tf CLI use on compute
          TRAINFABRIC_API_URL: opts.tfApiUrl,
          TRAINFABRIC_TOKEN: tfToken,
          TRAINFABRIC_DATASET_ID: datasetId ?? "",
          AUTORUN_GOAL: goal ?? "",
          PROTOCOL_JSON: JSON.stringify(run.protocol),
          REPO_URL: run.repo.url,
          REPO_FULL_NAME: run.repo.fullName ?? "",
          REPO_BRANCH: run.repo.defaultBranch,
          GITHUB_TOKEN: opts.githubToken ?? "",
          GITHUB_INSTALLATION_ID: run.repo.installationId
            ? String(run.repo.installationId)
            : "",
          COMPUTE_PROVIDER: compute.provider,
          MODAL_REF: compute.modalRef ?? "",
          RUNNER_ID: compute.runnerId ?? "",
          // Hermes (same Cloudflare AI Gateway as compute container)
          CF_ACCOUNT_ID: opts.env.CF_ACCOUNT_ID ?? "",
          CF_AI_GATEWAY_ID: opts.env.CF_AI_GATEWAY_ID ?? "default",
          CF_AI_GATEWAY_TOKEN: opts.env.CF_AI_GATEWAY_TOKEN ?? "",
          CF_AI_GATEWAY_BASE: opts.env.CF_AI_GATEWAY_BASE ?? "",
          CF_AI_MODEL:
            opts.env.CF_AI_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        },
      });
      run.box = {
        ...run.box,
        boxId: provisioned.boxId,
        desktopUrl: provisioned.desktopUrl,
        daemonHostUrl: provisioned.daemonHostUrl,
        campaignApiKeyId,
      };
      await logActivity(opts.store, id, "box", "Box sandbox provisioned", {
        boxId: provisioned.boxId,
      });
    } else {
      // Stub mode — AutoRun tracks without Box (local/dev)
      run.box = { ...run.box, boxId: `stub_${id}` };
      await logActivity(opts.store, id, "box", "Stub mode (no BOX_API_KEY on Worker)");
    }
    // Agent starts running immediately; it discovers/binds datasets itself (or asks in chat).
    run.status = "running";
    run.updatedAt = Date.now();
    await opts.store.upsertAutoRun(run);
    await logActivity(
      opts.store,
      id,
      "status",
      datasetId
        ? "Running — agent starting trials"
        : "Running — agent will discover a dataset from the repo brief (or ask in chat)",
    );
  } catch (e) {
    run.status = "error";
    run.error = e instanceof Error ? e.message : String(e);
    run.updatedAt = Date.now();
    await opts.store.upsertAutoRun(run);
    await revokeCampaignApiKey(opts.apiKeys, run);
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
  apiKeys?: ApiKeyStore | null,
): Promise<AutoRun> {
  if (run.status === "done" || run.status === "cancelled") return run;
  if (box && run.box.boxId && !run.box.boxId.startsWith("stub_")) {
    await box.interrupt(run.box.boxId).catch(() => undefined);
    await box.stop(run.box.boxId).catch(() => undefined);
  }
  const next = { ...run, status: "cancelled" as const, updatedAt: Date.now() };
  await store.upsertAutoRun(next);
  await revokeCampaignApiKey(apiKeys, run);
  await logActivity(store, run.id, "status", "Cancelled");
  return next;
}

export async function enqueueTrial(opts: {
  store: AutoStore;
  run: AutoRun;
  hypothesis?: string;
  commitSha?: string;
  /** Optional lakehouse handoff for managed Modal (s3:// + size → cluster tier). */
  dataSpec?: {
    uri: string;
    endpoint_url?: string;
    format?: string;
    region?: string;
    size_bytes?: number;
    estimated_bytes?: number;
    cluster?: boolean;
  };
  estimatedBytes?: number;
  gpuNodes?: number;
  callbackBaseUrl: string;
  /** When set, Modal/GPU clones via authenticated URL (token not stored on AutoRun). */
  githubToken?: string;
  env: {
    MODAL_TOKEN?: string;
    MODAL_APP_REF?: string;
    MODAL_API_BASE?: string;
    AGENT_TOKEN_SECRET?: string;
    GITHUB_TOKEN_CRYPTO_KEY?: string;
  };
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

  const fullName =
    opts.run.repo.fullName ||
    opts.run.repo.url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
  const repoUrl = opts.githubToken
    ? `https://x-access-token:${opts.githubToken}@github.com/${fullName}.git`
    : opts.run.repo.url;

  const provider = resolveComputeProvider(opts.run.compute, opts.env);
  const completionSecret =
    opts.env.AGENT_TOKEN_SECRET?.trim() ||
    opts.env.GITHUB_TOKEN_CRYPTO_KEY?.trim() ||
    "dev-trial-completion-secret";
  const sig = await signTrialCompletion(completionSecret, opts.run.id, trialId);
  const { externalId } = await provider.submitTrial({
    trialId,
    autoRunId: opts.run.id,
    repoUrl,
    commitSha: opts.commitSha,
    budgetSec: Math.min(opts.run.protocol.budget.maxWallClockSec, 3600),
    callbackUrl: `${opts.callbackBaseUrl}/auto/${opts.run.id}/trials/${trialId}/complete?sig=${sig}`,
    env: opts.githubToken ? { GITHUB_TOKEN: opts.githubToken } : undefined,
    dataSpec: opts.dataSpec,
    estimatedBytes: opts.estimatedBytes,
    gpuNodes: opts.gpuNodes,
  });

  // Managed GPU web endpoints often complete (via callback) before submitTrial returns.
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
  apiKeys?: ApiKeyStore | null;
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
    await revokeCampaignApiKey(opts.apiKeys, run);
    await logActivity(opts.store, run.id, "status", "Campaign complete — trial budget reached");
  }
  return { trial, run };
}

/** Join a Box hosted URL (may include ?_token=…) with a path like /chat. */
function boxHostPath(daemonHostUrl: string, path: string): string {
  try {
    const u = new URL(daemonHostUrl);
    const basePath = u.pathname.replace(/\/$/, "");
    u.pathname = `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
    return u.toString();
  } catch {
    return `${daemonHostUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }
}

async function refreshDaemonHostUrl(
  box: BoxClient,
  boxId: string,
): Promise<string | undefined> {
  try {
    // Prefer --public so Worker→Box /chat is not stuck behind a sticky gated token.
    const hosted = await box.command(boxId, "host 8787 --public 2>&1 || host 8787 --private 2>&1");
    const m = hosted.stdout?.match(/https:\/\/\S+/);
    return m?.[0]?.replace(/[.,;]+$/, "");
  } catch {
    return undefined;
  }
}

async function postBoxChat(
  daemonHostUrl: string,
  content: string,
  autoRunId: string,
): Promise<{ ok: boolean; agentReply?: string }> {
  const res = await fetch(boxHostPath(daemonHostUrl, "/chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; TrainfabricRouter/1.0; +https://trainfabric.ai)",
    },
    body: JSON.stringify({ content, autoRunId }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!res.ok) return { ok: false };
  let agentReply: string | undefined;
  try {
    const json = (await res.json()) as { reply?: string; message?: string };
    agentReply = (json.reply || json.message || "").trim() || undefined;
  } catch {
    /* 200 with non-JSON: delivered, no talk-back */
  }
  return { ok: true, agentReply };
}

async function postBoxChatViaCommand(
  box: BoxClient,
  boxId: string,
  content: string,
  autoRunId: string,
): Promise<{ ok: boolean; agentReply?: string }> {
  const payload = JSON.stringify({ content, autoRunId }).replace(/'/g, `'\\''`);
  try {
    const result = await box.command(
      boxId,
      `curl -sS -m 35 -X POST http://127.0.0.1:8787/chat -H 'Content-Type: application/json' -H 'Accept: application/json' -d '${payload}'`,
    );
    const raw = (result.stdout || "").trim();
    if (!raw) return { ok: false };
    try {
      const json = JSON.parse(raw) as { reply?: string; message?: string; ok?: boolean };
      if (json.ok === false) return { ok: false };
      const agentReply = (json.reply || json.message || "").trim() || undefined;
      return { ok: true, agentReply };
    } catch {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }
}

/** Deliver a steer instruction to the running Box agent for this AutoRun only. */
async function injectInstruction(
  box: BoxClient | null,
  run: AutoRun,
  content: string,
  store?: AutoStore,
): Promise<{ delivered: boolean; agentReply?: string }> {
  const boxId = run.box.boxId;
  if (!box || !boxId || boxId.startsWith("stub_")) {
    return { delivered: false };
  }

  const tryHostChat = async (url: string | undefined) => {
    if (!url) return null;
    try {
      return await postBoxChat(url, content, run.id);
    } catch {
      return null;
    }
  };

  // Preferred: daemon/shim HTTP chat on this run's hosted URL (Hermes talk-back).
  let hostUrl = run.box.daemonHostUrl;
  let chat = await tryHostChat(hostUrl);

  // Stale host tokens (403) are common after Box restarts — mint a fresh tunnel once.
  if (!chat?.ok) {
    const fresh = await refreshDaemonHostUrl(box, boxId);
    if (fresh && fresh !== hostUrl) {
      hostUrl = fresh;
      run.box = { ...run.box, daemonHostUrl: fresh };
      if (store) {
        await store.upsertAutoRun({
          ...run,
          box: run.box,
          updatedAt: Date.now(),
        });
      }
      chat = await tryHostChat(hostUrl);
    }
  }

  // Hosted URL can stay gated/broken; Box commands API → localhost /chat still works.
  if (!chat?.ok) {
    chat = await postBoxChatViaCommand(box, boxId, content, run.id);
  }

  if (chat?.ok) {
    return { delivered: true, agentReply: chat.agentReply };
  }

  // Fallback: drop the steer into the daemon inbox the loop polls (no live reply).
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

  const { delivered, agentReply } = await injectInstruction(
    opts.box,
    opts.run,
    content,
    opts.store,
  );

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
  let status = opts.run.status;
  const phase = opts.body.phase;
  // Agent asks for help → pause as awaiting_user; bindDataset / later heartbeats resume.
  if (phase === "awaiting_user" || phase === "awaiting_dataset") {
    if (status === "running" || status === "provisioning") status = "awaiting_user";
  } else if (
    status === "awaiting_user" &&
    opts.run.datasetId &&
    phase &&
    ["running", "enqueueing", "waiting_gpu", "starting"].includes(phase)
  ) {
    status = "running";
  }
  const next: AutoRun = {
    ...opts.run,
    status,
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

const ACTIVE_RUN_STATUSES = new Set(["provisioning", "running", "awaiting_user"]);
const DEAD_BOX_STATES = new Set([
  "stopped",
  "error",
  "deleted",
  "terminated",
  "dead",
  "destroyed",
]);
/** No heartbeat for this long while active → treat as dead (boxes stop without notifying us). */
export const AUTO_RUN_STALE_MS = 30 * 60 * 1000;

/**
 * Mark AutoRuns as error when their Box is stopped/gone or the daemon went silent.
 * Paused runs intentionally stop the box — skip those.
 */
export async function reconcileAutoRunLiveness(opts: {
  store: AutoStore;
  run: AutoRun;
  box: BoxClient | null;
  apiKeys?: ApiKeyStore | null;
  now?: number;
  staleMs?: number;
}): Promise<AutoRun> {
  const run = opts.run;
  if (!ACTIVE_RUN_STATUSES.has(run.status)) return run;

  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? AUTO_RUN_STALE_MS;
  let deadReason: string | null = null;

  const boxId = run.box.boxId;
  if (opts.box && boxId && !boxId.startsWith("stub_")) {
    try {
      const rec = await opts.box.get(boxId);
      const state = String(rec.state ?? "").toLowerCase();
      if (DEAD_BOX_STATES.has(state)) {
        deadReason = `Sandbox ${state} — agent can no longer report progress`;
      }
    } catch (e) {
      if (e instanceof BoxError && (e.status === 404 || e.status === 410)) {
        deadReason = "Sandbox no longer exists";
      }
      /* other Box API failures: fall through to heartbeat staleness */
    }
  }

  if (!deadReason) {
    const last = run.progress?.updatedAt || run.updatedAt || run.createdAt;
    if (typeof last === "number" && now - last > staleMs) {
      const mins = Math.max(1, Math.round((now - last) / 60_000));
      deadReason = `No agent heartbeat for ${mins}m — sandbox likely stopped`;
    }
  }

  if (!deadReason) return run;

  const next: AutoRun = {
    ...run,
    status: "error",
    error: deadReason,
    updatedAt: now,
  };
  await opts.store.upsertAutoRun(next);
  await revokeCampaignApiKey(opts.apiKeys, next);
  await logActivity(opts.store, next.id, "status", deadReason, { reconciled: true });

  try {
    const trials = await opts.store.listAutoTrials(next.id);
    for (const t of trials) {
      if (t.status === "pending" || t.status === "claimed" || t.status === "running") {
        await opts.store.upsertAutoTrial({
          ...t,
          status: "error",
          error: deadReason,
          updatedAt: now,
        });
      }
    }
  } catch {
    /* best-effort */
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

/** True when the caller owns this AutoRun (Clerk user or agent token for that user). */
export function ownsAutoRun(
  run: { ownerId: string },
  identity: { subject: string } | null | undefined,
): boolean {
  return Boolean(identity?.subject && run.ownerId === identity.subject);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-trial callback signature so managed GPU can complete without a user JWT. */
export async function signTrialCompletion(
  secret: string,
  runId: string,
  trialId: string,
): Promise<string> {
  return hmacHex(secret, `${runId}:${trialId}`);
}

export async function verifyTrialCompletion(
  secret: string,
  runId: string,
  trialId: string,
  sig: string | null | undefined,
): Promise<boolean> {
  if (!sig?.trim()) return false;
  const expected = await signTrialCompletion(secret, runId, trialId);
  if (expected.length !== sig.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return ok === 0;
}
