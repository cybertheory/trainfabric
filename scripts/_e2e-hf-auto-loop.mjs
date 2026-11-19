#!/usr/bin/env node
/**
 * End-to-end TrainFabric stress loop:
 *  1) Ingest public Hugging Face dataset (source_url)
 *  2) Poll job + verify schema/sample
 *  3) Start AutoRun (managed Modal GPU) against a research repo
 *  4) Message agent + poll trials
 *
 * Usage:
 *   node scripts/_e2e-hf-auto-loop.mjs [repo_url]
 */
import { readFileSync, existsSync } from "node:fs";
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

async function token() {
  return new SignJWT({
    email: "rishabhspro@gmail.com",
    scope: ["datasets:read", "datasets:write", "trainfabric", "auto"],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer("trainfabric-agent")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));
}

async function api(method, path, body, tok) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, json };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const HF_URL =
  process.env.TF_HF_URL ||
  "https://huggingface.co/datasets/scikit-learn/iris";

const REPO_URL =
  process.argv[2] ||
  process.env.TF_REPO_URL ||
  "https://github.com/cybertheory/trainfabric-starter-smoke";

async function main() {
  const tok = await token();
  const log = (step, data) => console.log(JSON.stringify({ step, ...data }, null, 2));

  // 0) Prerequisites
  const prereq = await api("GET", "/auto", null, tok);
  log("prerequisites", {
    status: prereq.status,
    prerequisites: prereq.json.prerequisites,
    modalRef: vars.MODAL_APP_REF?.slice(0, 60),
  });

  // 1) Ingest HF
  const name = `hf-iris-e2e-${Date.now().toString(36)}`;
  const pub = await api(
    "POST",
    "/datasets",
    {
      name,
      description: "E2E stress: public Hugging Face iris via source_url",
      tags: ["e2e", "huggingface", "iris"],
      visibility: "private",
      source_url: HF_URL,
      source_auth: "none",
    },
    tok,
  );
  log("ingest_submit", { status: pub.status, body: pub.json });
  if (!pub.ok) {
    process.exit(1);
  }
  const datasetId = pub.json.id || pub.json.datasetId || pub.json.dataset?.id;
  const jobId = pub.json.jobId || pub.json.job?.id || pub.json.job_id;
  if (!datasetId) {
    console.error("no dataset id");
    process.exit(1);
  }

  // 2) Poll job
  let job = null;
  for (let i = 0; i < 60; i++) {
    if (!jobId) break;
    const j = await api("GET", `/jobs/${jobId}`, null, tok);
    job = j.json;
    log("ingest_poll", { i, status: j.status, jobStatus: job.status || job.state, error: job.error });
    if (["done", "succeeded", "complete", "completed", "failed", "error"].includes(
      String(job.status || job.state || "").toLowerCase(),
    )) {
      break;
    }
    await sleep(5000);
  }

  // 3) Verify stored
  const schema = await api("GET", `/datasets/${datasetId}/schema`, null, tok);
  const sample = await api("POST", `/datasets/${datasetId}/sample`, { n: 3 }, tok);
  log("stored_check", {
    datasetId,
    schemaStatus: schema.status,
    columns: schema.json?.columns?.slice?.(0, 8) || schema.json?.schema?.columns?.slice?.(0, 8) || schema.json,
    sampleStatus: sample.status,
    sampleRows: sample.json?.rows?.length ?? sample.json?.data?.length ?? sample.json,
  });

  // 4) Start AutoRun
  const autoBody = {
    goal: `E2E stress on dataset ${datasetId}. Bind the dataset, write artifacts/data_spec.json with an s3:// URI (or /r2/ URL) from a small query_slice, commit, enqueue a managed Modal GPU trial, then report the score.`,
    datasetId,
    datasetIds: [datasetId],
    repoUrl: REPO_URL,
    protocol: {
      metric: { name: "score", direction: "min" },
      budget: { maxTrials: 3, maxWallClockSec: 1800, maxGpuSec: 900 },
      mutablePaths: ["train.py", "artifacts/**"],
      immutablePaths: ["prepare.py", "protocol.yaml"],
    },
    compute: { provider: "trainfabric_gpu" },
  };
  // Prefer GitHub App fields if present in env
  if (vars.TF_REPO_FULL_NAME && vars.TF_INSTALLATION_ID) {
    autoBody.repoFullName = vars.TF_REPO_FULL_NAME;
    autoBody.installationId = Number(vars.TF_INSTALLATION_ID);
    delete autoBody.repoUrl;
  }

  const started = await api("POST", "/auto", autoBody, tok);
  log("auto_start", { status: started.status, body: started.json });
  const autoRunId = started.json.id || started.json.run?.id || started.json.autoRunId;
  if (!started.ok || !autoRunId) {
    process.exit(2);
  }

  // 5) Message agent
  await sleep(8000);
  const msg1 = await api(
    "POST",
    `/auto/${autoRunId}/messages`,
    {
      content:
        "Bind the ingested iris/HF dataset if not bound. Query a small slice, write artifacts/data_spec.json (prefer s3://trainfabric-data/results/… from the query url key path, or keep /r2/ in data_url.txt). Commit and enqueue a trainfabric_gpu trial. Reply with what you did.",
      role: "user",
      source: "api",
    },
    tok,
  );
  log("message_1", { status: msg1.status, body: msg1.json });

  // 6) Poll status / trials / messages for ~10 min
  for (let i = 0; i < 40; i++) {
    const st = await api("GET", `/auto/${autoRunId}`, null, tok);
    const msgs = await api("GET", `/auto/${autoRunId}/messages?limit=10`, null, tok);
    const trials = st.json.trials || st.json.run?.trials || [];
    log("poll", {
      i,
      runStatus: st.json.run?.status || st.json.status,
      progress: st.json.run?.progress || st.json.progress,
      trials: trials.map((t) => ({
        id: t.id,
        status: t.status,
        score: t.score,
        error: t.error?.slice?.(0, 200),
        externalId: t.externalId,
      })),
      lastMsgs: (msgs.json.messages || msgs.json || [])
        .slice(-3)
        .map((m) => ({
          role: m.role,
          source: m.source,
          body: String(m.body || m.content || m.message || "").slice(0, 240),
        })),
    });
    const doneTrial = trials.find((t) => t.status === "done" || t.status === "error");
    if (doneTrial && i > 5) break;
    await sleep(15000);
  }

  // 7) Steer once more if no trial yet
  const again = await api(
    "POST",
    `/auto/${autoRunId}/messages`,
    {
      content:
        "If no GPU trial completed yet: ensure data handoff file exists, push commit, run tf auto trial with --estimated-bytes from estimate_query. Then summarize trial scores.",
      role: "user",
      source: "api",
    },
    tok,
  );
  log("message_2", { status: again.status });

  for (let i = 0; i < 20; i++) {
    const st = await api("GET", `/auto/${autoRunId}`, null, tok);
    const trials = st.json.trials || [];
    log("poll_final", {
      i,
      runStatus: st.json.run?.status || st.json.status,
      trials: trials.map((t) => ({ id: t.id, status: t.status, score: t.score, error: t.error?.slice?.(0, 300) })),
    });
    if (trials.some((t) => t.status === "done" || t.status === "error")) break;
    await sleep(15000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
