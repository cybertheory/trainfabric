#!/usr/bin/env node
/** Clerk-auth mid-size ingest then bigger Modal trials. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
spawnSync(process.execPath, [join(root, "scripts/_prep-e2e-auth.mjs")], {
  stdio: "inherit",
  cwd: root,
});

const auth = JSON.parse(readFileSync("/tmp/tf-clerk-session.json", "utf8"));
const base = String(auth.base).replace(/\/$/, "");
const jwt = auth.jwt;
const REPO = "https://github.com/cybertheory/trainfabric-e2e-smoke";
const TEMPLATE = "bx_ckhpxtn3";
const URLS = [
  "https://huggingface.co/datasets/openai/gsm8k/resolve/main/main/train-00000-of-00001.parquet",
  "https://huggingface.co/datasets/fancyzhx/ag_news/resolve/main/data/test-00000-of-00001.parquet",
];

function log(step, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, ...data }, null, 2));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; TrainfabricE2E/1.0)",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

async function ingest(sourceUrl) {
  const name = `e2e-mid-${Date.now().toString(36)}`;
  const pub = await api("POST", "/datasets", {
    name,
    description: `Mid-size HF: ${sourceUrl}`,
    tags: ["e2e", "hf", "mid"],
    visibility: "private",
    source_url: sourceUrl,
    source_auth: "none",
  });
  log("ingest_submit", { sourceUrl, status: pub.status, body: pub.json });
  if (!pub.ok) return null;
  const datasetId = pub.json.datasetId || pub.json.id;
  const jobId = pub.json.jobId;
  const deadline = Date.now() + 10 * 60_000;
  let i = 0;
  while (Date.now() < deadline) {
    const j = await api("GET", `/jobs/${jobId}`, null);
    const job = j.json.job || j.json;
    log("ingest_poll", { i, datasetId, status: job.status, progress: job.progress, error: job.error });
    if (["done", "error", "failed"].includes(String(job.status))) {
      if (job.status !== "done") return null;
      const schema = await api("GET", `/datasets/${datasetId}/schema`, null);
      log("ingest_ok", {
        datasetId,
        rowCount: schema.json?.rowCount ?? schema.json?.schema?.rowCount,
        cols: (schema.json?.columns || schema.json?.schema?.columns || []).length,
      });
      return datasetId;
    }
    i += 1;
    await sleep(10_000);
  }
  return null;
}

function stage(bytes) {
  const key = `results/e2e-midmodal-${bytes}-${Date.now()}.bin`;
  const local = `/tmp/${key.split("/").pop()}`;
  const header = Buffer.from(`trainfabric-e2e-big-slice-v1 bytes=${bytes}\n`);
  writeFileSync(local, Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - header.length), 0x61)]).subarray(0, bytes));
  execSync(
    `cd ${join(root, "services/router")} && npx wrangler r2 object put trainfabric-data/${key} --file=${local} --remote`,
    { stdio: "inherit" },
  );
  const dataSpec = { uri: `s3://trainfabric-data/${key}`, format: "bin", size_bytes: bytes };
  const repo = `/tmp/tf-midmodal-${bytes}-${Date.now()}`;
  execSync(`rm -rf ${repo} && git clone --depth 1 ${REPO} ${repo}`, { stdio: "inherit" });
  mkdirSync(`${repo}/artifacts`, { recursive: true });
  writeFileSync(`${repo}/artifacts/data_spec.json`, JSON.stringify(dataSpec, null, 2) + "\n");
  writeFileSync(`${repo}/artifacts/data_url.txt`, `${base}/r2/${key}\n`);
  execSync(
    `cd ${repo} && git add artifacts && git -c user.email=e2e@trainfabric.dev -c user.name=e2e commit -m "e2e ${bytes}b" && git push`,
    { stdio: "inherit" },
  );
  return {
    dataSpec,
    sha: execSync(`cd ${repo} && git rev-parse HEAD`).toString().trim(),
    bytes,
  };
}

const datasets = [];
for (const u of URLS) {
  const id = await ingest(u);
  if (id) datasets.push(id);
}
if (!datasets.length) {
  console.error("No mid-size ingest succeeded");
  process.exit(1);
}

const primary = datasets[0];
const started = await api("POST", "/auto", {
  goal: `Mid/big HF E2E on ${datasets.join(",")}. Confirm GOLDEN_OK; evaluate Modal trial scores.`,
  datasetId: primary,
  datasetIds: datasets,
  repoUrl: REPO,
  templateId: TEMPLATE,
  protocol: {
    metric: { name: "score", direction: "min" },
    budget: { maxTrials: 4, maxWallClockSec: 1800, maxGpuSec: 900 },
    mutablePaths: ["train.py", "artifacts/**"],
    immutablePaths: ["prepare.py", "protocol.yaml"],
  },
  compute: { provider: "trainfabric_gpu" },
});
log("auto_start", { status: started.status, body: started.json });
const autoRunId = started.json.id || started.json.run?.id;
if (!started.ok || !autoRunId) process.exit(2);
const boxId = started.json.box?.boxId;

await sleep(12_000);
const msg1 = await api("POST", `/auto/${autoRunId}/messages`, {
  content: "Confirm GOLDEN_OK httpx+tf ready.",
  role: "user",
  source: "api",
});
log("message_1", {
  status: msg1.status,
  reply: String(msg1.json?.assistantMessage?.content || msg1.json?.reply || "").slice(0, 300),
});

const sizes = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];
const wanted = [];
for (const n of sizes) {
  const h = stage(n);
  const trial = await api("POST", `/auto/${autoRunId}/trials`, {
    hypothesis: `mid/big Modal ${h.bytes}B`,
    commitSha: h.sha,
    dataSpec: h.dataSpec,
    estimatedBytes: h.bytes,
  });
  log("trial_enqueue", { bytes: h.bytes, status: trial.status, body: trial.json });
  const id = trial.json.id || trial.json.trial?.id;
  if (trial.ok && id) wanted.push({ id, bytes: h.bytes });
}

let trials = [];
for (let i = 0; i < 60; i++) {
  await sleep(10_000);
  const st = await api("GET", `/auto/${autoRunId}`, null);
  trials = st.json.trials || [];
  log("poll", {
    i,
    boxId,
    trials: trials.map((t) => ({
      id: t.id,
      status: t.status,
      score: t.score,
      error: t.error?.slice?.(0, 200),
      externalId: t.externalId,
    })),
  });
  if (wanted.every((w) => trials.some((t) => t.id === w.id && ["done", "error", "cancelled"].includes(t.status)))) break;
}

const msg2 = await api("POST", `/auto/${autoRunId}/messages`, {
  content: `Summarize scores. Expected ${sizes.join(", ")}.`,
  role: "user",
  source: "api",
});
log("message_2", {
  status: msg2.status,
  reply: String(msg2.json?.assistantMessage?.content || msg2.json?.reply || "").slice(0, 400),
});

const summary = { datasets, autoRunId, boxId, expected: sizes, trials };
writeFileSync("/tmp/tf-e2e-midbig-summary.json", JSON.stringify(summary, null, 2));
log("summary", summary);
const ok =
  wanted.length > 0 &&
  wanted.every((w) => trials.some((t) => t.id === w.id && t.status === "done" && Number(t.score) === w.bytes));
console.log(ok ? "MID/BIG E2E PASSED" : "MID/BIG E2E FAILED");
process.exit(ok ? 0 : 3);
