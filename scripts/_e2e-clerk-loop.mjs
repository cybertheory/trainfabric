#!/usr/bin/env node
/** Complete e2e with Clerk session JWT: HF ingest → verify → enqueue Modal trial. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const auth = JSON.parse(readFileSync("/tmp/tf-clerk-session.json", "utf8"));
const base = String(auth.base || "https://trainfabric-router.rishabhspro.workers.dev").replace(
  /\/$/,
  "",
);
const jwt = auth.jwt;
const autoRunId = process.argv[2] || "auto_f790472dca81";
const repoUrl = "https://github.com/cybertheory/trainfabric-e2e-smoke";

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "trainfabric-e2e/1.0",
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const log = (step, data) => {
  console.log(JSON.stringify({ step, ...data }, null, 2));
  writeFileSync("/tmp/tf-e2e-final.jsonl", JSON.stringify({ step, ...data }) + "\n", { flag: "a" });
};

// 1) Proper HF ingest via source_url
const pub = await api("POST", "/datasets", {
  name: `hf-iris-clerk-${Date.now().toString(36)}`,
  description: "E2E HF iris via Clerk session + source_url",
  tags: ["e2e", "huggingface", "iris"],
  visibility: "private",
  source_url: "https://huggingface.co/datasets/scikit-learn/iris",
  source_auth: "none",
});
log("ingest", { status: pub.status, body: pub.json });
const datasetId = pub.json.id || pub.json.datasetId || pub.json.dataset?.id;
const jobId = pub.json.jobId || pub.json.job?.id;
if (!pub.ok || !datasetId) process.exit(1);

// 2) Poll job
for (let i = 0; i < 48; i++) {
  const j = await api("GET", `/jobs/${jobId}`);
  const status = j.json.status || j.json.job?.status;
  log("poll_job", { i, status, error: j.json.error || j.json.job?.error, progress: j.json.progress });
  if (["done", "succeeded", "completed", "failed", "error"].includes(String(status || "").toLowerCase())) {
    break;
  }
  await sleep(8000);
}

// 3) Schema + sample + query
const schema = await api("GET", `/datasets/${datasetId}/schema`);
const sample = await api("POST", `/datasets/${datasetId}/sample`, { n: 2 });
log("stored", {
  schemaStatus: schema.status,
  columns: schema.json?.columns || schema.json?.schema?.columns || Object.keys(schema.json || {}),
  sampleStatus: sample.status,
  samplePreview: JSON.stringify(sample.json).slice(0, 400),
});

const query = await api("POST", `/datasets/${datasetId}/query`, {
  columns: [],
  limit: 50,
  mode: "link",
});
log("query", { status: query.status, body: JSON.stringify(query.json).slice(0, 600) });
const url = query.json.url || query.json.result?.url;
const sizeBytes = query.json.sizeBytes || query.json.estimatedBytes || 50_000;

if (url && String(url).includes("/r2/")) {
  const key = String(url).split("/r2/")[1];
  const dataSpec = {
    uri: `s3://trainfabric-data/${key}`,
    format: "parquet",
    size_bytes: sizeBytes,
  };
  // Commit handoff to smoke repo via local git
  const { execSync } = await import("node:child_process");
  const dir = "/tmp/tf-e2e-handoff-repo";
  execSync(`rm -rf ${dir} && git clone --depth 1 ${repoUrl} ${dir}`, { stdio: "inherit" });
  writeFileSync(`${dir}/artifacts/data_spec.json`, JSON.stringify(dataSpec, null, 2) + "\n");
  writeFileSync(`${dir}/artifacts/data_url.txt`, url + "\n");
  execSync(
    `cd ${dir} && git add artifacts/data_spec.json artifacts/data_url.txt && git -c user.email=e2e@trainfabric.dev -c user.name=e2e commit -m "e2e data handoff" && git push`,
    { stdio: "inherit" },
  );
  const sha = execSync(`cd ${dir} && git rev-parse HEAD`).toString().trim();
  log("handoff_pushed", { sha, dataSpec, url });

  // 4) Enqueue trial on existing AutoRun
  const trial = await api("POST", `/auto/${autoRunId}/trials`, {
    hypothesis: "e2e managed Modal + CloudBucketMount /r2 handoff",
    commitSha: sha,
    dataSpec,
    estimatedBytes: sizeBytes,
  });
  log("enqueue_trial", { status: trial.status, body: trial.json });
} else {
  log("no_query_url", { query: query.json });
}

// 5) Poll trials
for (let i = 0; i < 40; i++) {
  const st = await api("GET", `/auto/${autoRunId}`);
  const trials = st.json.trials || [];
  log("poll_auto", {
    i,
    runStatus: st.json.run?.status || st.json.status,
    trials: trials.map((t) => ({
      id: t.id,
      status: t.status,
      score: t.score,
      error: t.error?.slice?.(0, 300),
      externalId: t.externalId,
    })),
  });
  if (trials.some((t) => t.status === "done" || t.status === "error")) break;
  await sleep(15000);
}

// 6) Message agent about results
await api("POST", `/auto/${autoRunId}/messages`, {
  content: "E2E driver finished enqueueing a Modal trial from HF-ingested data. Summarize trial scores/errors.",
  role: "user",
  source: "api",
});
log("done", { autoRunId, datasetId });
