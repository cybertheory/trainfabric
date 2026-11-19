#!/usr/bin/env node
/**
 * Bigger Modal stress using already-ingested datasets (skips HF wait).
 * Stages 256KiB / 1MiB / 4MiB R2 handoffs, starts AutoRun, enqueues trials.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const auth = JSON.parse(readFileSync("/tmp/tf-clerk-session.json", "utf8"));
const base = String(auth.base).replace(/\/$/, "");
const jwt = auth.jwt;
const REPO = "https://github.com/cybertheory/trainfabric-e2e-smoke";
const TEMPLATE = process.env.BOX_TEMPLATE_ID || "bx_ckhpxtn3";
const DATASET_IDS = (process.env.TF_DATASET_IDS || "ds_bac876ae00594b7c,ds_911672bbcf4545fb")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function log(step, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, ...data }, null, 2));
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function stage(bytes) {
  const key = `results/e2e-big-${bytes}-${Date.now()}.bin`;
  const local = `/tmp/e2e-big-${bytes}.bin`;
  const header = Buffer.from(`trainfabric-e2e-big-slice-v1 bytes=${bytes}\n`);
  const pad = Buffer.alloc(Math.max(0, bytes - header.length), 0x61);
  writeFileSync(local, Buffer.concat([header, pad]).subarray(0, bytes));
  execSync(
    `cd ${join(root, "services/router")} && npx wrangler r2 object put trainfabric-data/${key} --file=${local} --remote`,
    { stdio: "inherit" },
  );
  const dataSpec = { uri: `s3://trainfabric-data/${key}`, format: "bin", size_bytes: bytes };
  const url = `${base}/r2/${key}`;
  const repo = `/tmp/tf-e2e-big-${bytes}-${Date.now()}`;
  execSync(`rm -rf ${repo} && git clone --depth 1 ${REPO} ${repo}`, { stdio: "inherit" });
  mkdirSync(`${repo}/artifacts`, { recursive: true });
  writeFileSync(`${repo}/artifacts/data_spec.json`, JSON.stringify(dataSpec, null, 2) + "\n");
  writeFileSync(`${repo}/artifacts/data_url.txt`, url + "\n");
  execSync(
    `cd ${repo} && git add artifacts && git -c user.email=e2e@trainfabric.dev -c user.name=e2e commit -m "e2e big ${bytes}b" && git push`,
    { stdio: "inherit" },
  );
  const sha = execSync(`cd ${repo} && git rev-parse HEAD`).toString().trim();
  return { key, url, dataSpec, sha, bytes };
}

const who = await api("GET", "/auth/whoami", null);
log("whoami", { status: who.status, body: who.json });
if (!who.ok) process.exit(1);

const primary = DATASET_IDS[0];
const started = await api("POST", "/auto", {
  goal: `Bigger-data E2E: evaluate Modal scores for ${DATASET_IDS.join(", ")}. Acknowledge GOLDEN_OK.`,
  datasetId: primary,
  datasetIds: DATASET_IDS,
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
const boxId = started.json.box?.boxId || started.json.run?.box?.boxId;

await sleep(12_000);
const msg1 = await api("POST", `/auto/${autoRunId}/messages`, {
  content: "Confirm GOLDEN_OK httpx+tf ready. We will enqueue larger Modal trials next.",
  role: "user",
  source: "api",
});
log("message_1", {
  status: msg1.status,
  reply: String(msg1.json?.assistantMessage?.content || msg1.json?.reply || "").slice(0, 300),
});

const sizes = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];
const handoffs = sizes.map((n) => stage(n));
const wanted = [];
for (const h of handoffs) {
  const trial = await api("POST", `/auto/${autoRunId}/trials`, {
    hypothesis: `bigger Modal mount ${h.bytes}B`,
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
    runStatus: st.json.status || st.json.run?.status,
    boxId,
    trials: trials.map((t) => ({
      id: t.id,
      status: t.status,
      score: t.score,
      error: t.error?.slice?.(0, 200),
      externalId: t.externalId,
    })),
  });
  if (wanted.every((w) => trials.some((t) => t.id === w.id && ["done", "error", "cancelled"].includes(t.status)))) {
    break;
  }
}

const msg2 = await api("POST", `/auto/${autoRunId}/messages`, {
  content: `Summarize trial scores. Expected ≈ ${sizes.join(", ")} (byte lengths).`,
  role: "user",
  source: "api",
});
log("message_2", {
  status: msg2.status,
  reply: String(msg2.json?.assistantMessage?.content || msg2.json?.reply || "").slice(0, 500),
});

const summary = {
  datasets: DATASET_IDS,
  autoRunId,
  boxId,
  expected: sizes,
  trials: trials.map((t) => ({
    id: t.id,
    status: t.status,
    score: t.score,
    error: t.error?.slice?.(0, 300),
    externalId: t.externalId,
  })),
};
writeFileSync("/tmp/tf-e2e-big-modal-summary.json", JSON.stringify(summary, null, 2));
log("summary", summary);

const ok = wanted.length > 0 && wanted.every((w) =>
  trials.some((t) => t.id === w.id && t.status === "done" && Number(t.score) === w.bytes),
);
if (!ok) {
  console.error("BIG MODAL E2E FAILED");
  process.exit(3);
}
console.log("BIG MODAL E2E PASSED");
