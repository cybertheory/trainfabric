#!/usr/bin/env node
/**
 * Bigger-dataset E2E stress:
 *  1) Ingest multiple public HF datasets (medium/large)
 *  2) Poll until done + verify schema/row counts
 *  3) Start AutoRun on golden Box + smoke repo
 *  4) Chat + bind primary dataset
 *  5) Stage a larger R2 handoff, enqueue Modal trial(s), evaluate scores
 *
 * Usage:
 *   node scripts/_e2e-big-hf-loop.mjs
 *   TF_HF_URLS="url1,url2" node scripts/_e2e-big-hf-loop.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { SignJWT } = createRequire(join(root, "services/router/package.json"))("jose");

function loadVars(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const vars = {
  ...loadVars(join(root, "services/compute/.env.local")),
  ...loadVars(join(root, "services/router/.dev.vars")),
};
const base = (vars.PUBLIC_API_BASE || "https://trainfabric-router.rishabhspro.workers.dev").replace(
  /\/$/,
  "",
);
const subject = "user_3H1i74IdIFMqzzZ5VpXd6YFVKGh";
const REPO_URL = process.env.TF_REPO_URL || "https://github.com/cybertheory/trainfabric-e2e-smoke";
const TEMPLATE = process.env.BOX_TEMPLATE_ID || vars.BOX_TEMPLATE_ID || "bx_ckhpxtn3";

/** Bigger than iris/demo1 but within compute/Iceberg comfort zone.
 * Prefer direct parquet resolve URLs (single file) over full dataset trees.
 */
const DATASETS = (
  process.env.TF_HF_URLS ||
  [
    // ~2.3MB
    "https://huggingface.co/datasets/openai/gsm8k/resolve/main/main/train-00000-of-00001.parquet",
    // ~1.2MB
    "https://huggingface.co/datasets/fancyzhx/ag_news/resolve/main/data/test-00000-of-00001.parquet",
    // ~18.6MB — larger shard stress
    "https://huggingface.co/datasets/fancyzhx/ag_news/resolve/main/data/train-00000-of-00001.parquet",
    // ~21MB
    "https://huggingface.co/datasets/stanfordnlp/imdb/resolve/main/plain_text/train-00000-of-00001.parquet",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(step, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), step, ...data }, null, 2);
  console.log(line);
  if (typeof process.stdout?.write === "function") process.stdout.write("");
}

async function token() {
  const candidates = [];

  try {
    const auth = JSON.parse(readFileSync("/tmp/tf-clerk-session.json", "utf8"));
    if (auth.jwt && auth.base) {
      candidates.push({
        kind: "clerk",
        tok: auth.jwt,
        base: String(auth.base).replace(/\/$/, ""),
      });
    }
  } catch {
    /* none */
  }

  try {
    const ak = JSON.parse(readFileSync("/tmp/tf-clerk-ak.json", "utf8"));
    if (ak.secret) {
      candidates.push({
        kind: "api_key",
        tok: ak.secret,
        base: String(ak.base || base).replace(/\/$/, ""),
      });
    }
  } catch {
    /* none */
  }

  for (const c of candidates) {
    const probe = await fetch(`${c.base}/auth/whoami`, {
      headers: {
        Authorization: `Bearer ${c.tok}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; TrainfabricE2E/1.0)",
      },
    });
    if (!probe.ok) continue;
    // Prefer write-capable identities (not agent-token read-only).
    const body = await probe.json().catch(() => ({}));
    if (body?.authVia === "agent_token" || body?.profile?.isAgent) continue;
    return c;
  }

  throw new Error(
    "No write-capable auth. Run: node scripts/_mint-clerk-session.mjs && node scripts/_mint-clerk-ak.mjs",
  );
}

async function api(auth, method, path, body) {
  const res = await fetch(`${auth.base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.tok}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; TrainfabricE2E/1.0)",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  return { status: res.status, ok: res.ok, json };
}

async function ingestOne(auth, sourceUrl) {
  const slug = sourceUrl.replace(/https?:\/\/huggingface\.co\/datasets\//, "").replace(/\W+/g, "-").slice(0, 40);
  const name = `e2e-big-${slug}-${Date.now().toString(36)}`;
  const pub = await api(auth, "POST", "/datasets", {
    name,
    description: `E2E bigger HF ingest: ${sourceUrl}`,
    tags: ["e2e", "huggingface", "big", slug],
    visibility: "private",
    source_url: sourceUrl,
    source_auth: "none",
  });
  log("ingest_submit", { sourceUrl, status: pub.status, body: pub.json });
  if (!pub.ok) return { sourceUrl, ok: false, error: pub.json };
  const datasetId = pub.json.id || pub.json.datasetId || pub.json.dataset?.id;
  const jobId = pub.json.jobId || pub.json.job?.id || pub.json.job_id;
  let job = null;
  const deadline = Date.now() + 12 * 60_000;
  let i = 0;
  while (Date.now() < deadline) {
    const j = await api(auth, "GET", `/jobs/${jobId}`, null);
    job = j.json.job || j.json;
    log("ingest_poll", {
      sourceUrl,
      i,
      datasetId,
      jobId,
      status: job.status,
      progress: job.progress,
      error: job.error,
    });
    if (["done", "error", "failed"].includes(String(job.status || "").toLowerCase())) break;
    i += 1;
    await sleep(8000);
  }
  const schema = await api(auth, "GET", `/datasets/${datasetId}/schema`, null);
  const cols = schema.json?.columns || schema.json?.schema?.columns || [];
  const rowCount =
    schema.json?.rowCount ??
    schema.json?.schema?.rowCount ??
    cols?.[0]?.distinctCount ??
    null;
  const sample = await api(auth, "POST", `/datasets/${datasetId}/sample`, { n: 5 });
  const sampleRows = sample.json?.rows || sample.json?.data || sample.json?.sampleRows || [];
  const ok = String(job?.status).toLowerCase() === "done" && schema.ok;
  log("ingest_result", {
    sourceUrl,
    ok,
    datasetId,
    jobId,
    jobStatus: job?.status,
    progress: job?.progress,
    error: job?.error,
    rowCount,
    columnCount: Array.isArray(cols) ? cols.length : null,
    sampleN: Array.isArray(sampleRows) ? sampleRows.length : 0,
  });
  return {
    sourceUrl,
    ok,
    datasetId,
    jobId,
    job,
    rowCount,
    columnCount: Array.isArray(cols) ? cols.length : 0,
    sampleN: Array.isArray(sampleRows) ? sampleRows.length : 0,
  };
}

function stageBiggerHandoff(bytes = 256 * 1024) {
  const key = `results/e2e-big-${Date.now()}.bin`;
  const local = `/tmp/e2e-big-slice.bin`;
  // Deterministic payload so Modal score == byte length (smoke train.py)
  const header = Buffer.from(`trainfabric-e2e-big-slice-v1 bytes=${bytes}\n`);
  const pad = Buffer.alloc(Math.max(0, bytes - header.length), 0x61); // 'a'
  writeFileSync(local, Buffer.concat([header, pad]).subarray(0, bytes));
  execSync(
    `cd ${join(root, "services/router")} && npx wrangler r2 object put trainfabric-data/${key} --file=${local} --remote`,
    { stdio: "inherit" },
  );
  const url = `${base}/r2/${key}`;
  const dataSpec = {
    uri: `s3://trainfabric-data/${key}`,
    format: "bin",
    size_bytes: bytes,
  };
  const repo = `/tmp/tf-e2e-big-handoff-${Date.now()}`;
  execSync(`rm -rf ${repo} && git clone --depth 1 ${REPO_URL} ${repo}`, { stdio: "inherit" });
  mkdirSync(`${repo}/artifacts`, { recursive: true });
  writeFileSync(`${repo}/artifacts/data_spec.json`, JSON.stringify(dataSpec, null, 2) + "\n");
  writeFileSync(`${repo}/artifacts/data_url.txt`, url + "\n");
  writeFileSync(
    `${repo}/artifacts/e2e_meta.json`,
    JSON.stringify({ key, bytes, createdAt: new Date().toISOString() }, null, 2) + "\n",
  );
  execSync(
    `cd ${repo} && git add artifacts && git -c user.email=e2e@trainfabric.dev -c user.name=e2e commit -m "e2e big r2 handoff ${bytes}b" && git push`,
    { stdio: "inherit" },
  );
  const sha = execSync(`cd ${repo} && git rev-parse HEAD`).toString().trim();
  return { key, url, dataSpec, sha, bytes };
}

async function main() {
  const auth = await token();
  log("auth", { kind: auth.kind, base: auth.base, datasets: DATASETS.length });

  const prereq = await api(auth, "GET", "/auto", null);
  log("prerequisites", {
    status: prereq.status,
    boxConfigured: prereq.json?.prerequisites?.boxConfigured,
    note: prereq.json?.prerequisites?.note,
    template: TEMPLATE,
  });

  // 1) Ingest bigger datasets sequentially (catalog/compute contention safer)
  const ingestResults = [];
  for (const url of DATASETS) {
    ingestResults.push(await ingestOne(auth, url));
  }
  const okIngests = ingestResults.filter((r) => r.ok);
  log("ingest_summary", {
    total: ingestResults.length,
    ok: okIngests.length,
    failed: ingestResults.filter((r) => !r.ok).map((r) => ({
      url: r.sourceUrl,
      error: r.job?.error || r.error,
      status: r.job?.status,
    })),
    datasets: okIngests.map((r) => ({
      id: r.datasetId,
      rows: r.rowCount,
      cols: r.columnCount,
      url: r.sourceUrl,
    })),
  });
  if (!okIngests.length) {
    console.error("No successful bigger ingest — aborting");
    process.exit(1);
  }

  const primary = okIngests.sort((a, b) => (b.rowCount || 0) - (a.rowCount || 0))[0];

  // 2) Start AutoRun
  const started = await api(auth, "POST", "/auto", {
    goal: `E2E bigger-data stress on ${primary.datasetId} (${primary.sourceUrl}). Bind dataset, acknowledge chat, evaluate Modal trial scores from R2-mounted handoff.`,
    datasetId: primary.datasetId,
    datasetIds: okIngests.map((r) => r.datasetId),
    repoUrl: REPO_URL,
    templateId: TEMPLATE,
    protocol: {
      metric: { name: "score", direction: "min" },
      budget: { maxTrials: 3, maxWallClockSec: 1800, maxGpuSec: 900 },
      mutablePaths: ["train.py", "artifacts/**"],
      immutablePaths: ["prepare.py", "protocol.yaml"],
    },
    compute: { provider: "trainfabric_gpu" },
  });
  log("auto_start", { status: started.status, body: started.json });
  const autoRunId = started.json.id || started.json.run?.id || started.json.autoRunId;
  if (!started.ok || !autoRunId) process.exit(2);
  const boxId = started.json.box?.boxId || started.json.run?.box?.boxId;

  await sleep(10_000);

  // 3) Chat
  const msg1 = await api(auth, "POST", `/auto/${autoRunId}/messages`, {
    content: `You are on the rebuilt golden Box. Confirm GOLDEN_OK, bind ${primary.datasetId} if needed, and prepare to evaluate Modal trial scores on the bigger HF ingest.`,
    role: "user",
    source: "api",
  });
  log("message_1", {
    status: msg1.status,
    reply: String(
      msg1.json?.assistantMessage?.content || msg1.json?.reply || msg1.json?.message || "",
    ).slice(0, 400),
  });

  // 4) Stage bigger handoffs (256KiB + 1MiB) and enqueue Modal trials
  const handoffs = [256 * 1024, 1024 * 1024].map((n) => stageBiggerHandoff(n));
  const trialIds = [];
  for (const h of handoffs) {
    const trial = await api(auth, "POST", `/auto/${autoRunId}/trials`, {
      hypothesis: `e2e big Modal mount ${h.bytes}B from HF-backed campaign`,
      commitSha: h.sha,
      dataSpec: h.dataSpec,
      estimatedBytes: h.bytes,
    });
    log("trial_enqueue", { bytes: h.bytes, status: trial.status, body: trial.json });
    const id = trial.json.id || trial.json.trial?.id;
    if (trial.ok && id) trialIds.push({ id, bytes: h.bytes, sha: h.sha });
  }

  // 5) Poll trials
  let finalTrials = [];
  for (let i = 0; i < 48; i++) {
    await sleep(10_000);
    const st = await api(auth, "GET", `/auto/${autoRunId}`, null);
    const msgs = await api(auth, "GET", `/auto/${autoRunId}/messages?limit=8`, null);
    finalTrials = st.json.trials || st.json.run?.trials || [];
    log("poll", {
      i,
      runStatus: st.json.run?.status || st.json.status,
      boxId,
      trials: finalTrials.map((t) => ({
        id: t.id,
        status: t.status,
        score: t.score,
        error: t.error?.slice?.(0, 240),
        externalId: t.externalId,
      })),
      lastMsgs: (msgs.json.messages || msgs.json || []).slice(-2).map((m) => ({
        role: m.role,
        source: m.source,
        body: String(m.content || m.body || "").slice(0, 200),
      })),
    });
    const terminal = finalTrials.filter((t) => ["done", "error", "cancelled"].includes(t.status));
    if (trialIds.length && terminal.length >= trialIds.length) break;
  }

  const msg2 = await api(auth, "POST", `/auto/${autoRunId}/messages`, {
    content: `E2E bigger-data complete. Summarize trial scores. Expected scores ≈ ${handoffs.map((h) => h.bytes).join(" and ")} (byte lengths).`,
    role: "user",
    source: "api",
  });
  log("message_2", {
    status: msg2.status,
    reply: String(
      msg2.json?.assistantMessage?.content || msg2.json?.reply || "",
    ).slice(0, 500),
  });

  const summary = {
    ingest: ingestResults.map((r) => ({
      url: r.sourceUrl,
      ok: r.ok,
      datasetId: r.datasetId,
      rows: r.rowCount,
      cols: r.columnCount,
      error: r.job?.error || null,
    })),
    autoRunId,
    boxId,
    trials: finalTrials.map((t) => ({
      id: t.id,
      status: t.status,
      score: t.score,
      error: t.error?.slice?.(0, 300),
      externalId: t.externalId,
    })),
    expectedScores: handoffs.map((h) => h.bytes),
  };
  writeFileSync("/tmp/tf-e2e-big-summary.json", JSON.stringify(summary, null, 2));
  log("summary", summary);

  const allTrialsOk =
    trialIds.length > 0 &&
    trialIds.every((want) =>
      finalTrials.some((t) => t.id === want.id && t.status === "done" && Number(t.score) === want.bytes),
    );
  const ingestOk = okIngests.length >= 1;
  if (!ingestOk || !allTrialsOk) {
    console.error("E2E bigger-data FAILED", { ingestOk, allTrialsOk, okIngests: okIngests.length });
    process.exit(3);
  }
  console.log("E2E bigger-data PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
