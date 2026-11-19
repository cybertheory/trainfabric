#!/usr/bin/env node
/** Start AutoRun as Clerk user + enqueue Modal trial with R2 handoff already pushed. */
import { readFileSync } from "node:fs";

const auth = JSON.parse(readFileSync("/tmp/tf-clerk-session.json", "utf8"));
const trialMeta = JSON.parse(readFileSync("/tmp/tf-e2e-trial.json", "utf8"));
const base = String(auth.base).replace(/\/$/, "");
const jwt = auth.jwt;

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
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

const started = await api("POST", "/auto", {
  goal: "E2E Modal CloudBucketMount stress — evaluate R2-mounted slice score",
  datasetId: "ds_d7c890e943a64abd",
  repoUrl: "https://github.com/cybertheory/trainfabric-e2e-smoke",
  protocol: {
    metric: { name: "score", direction: "min" },
    budget: { maxTrials: 2, maxWallClockSec: 1200, maxGpuSec: 600 },
    mutablePaths: ["train.py", "artifacts/**"],
    immutablePaths: ["prepare.py", "protocol.yaml"],
  },
  compute: { provider: "trainfabric_gpu" },
});
console.log(JSON.stringify({ start: started.status, body: started.json }, null, 2));
const autoRunId = started.json.id || started.json.run?.id;
if (!started.ok || !autoRunId) process.exit(1);

const trial = await api("POST", `/auto/${autoRunId}/trials`, {
  hypothesis: "e2e managed Modal + R2 mount",
  commitSha: trialMeta.sha,
  dataSpec: trialMeta.dataSpec,
  estimatedBytes: 40,
});
console.log(JSON.stringify({ trial: trial.status, body: trial.json }, null, 2));

for (let i = 0; i < 36; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const st = await api("GET", `/auto/${autoRunId}`);
  const trials = st.json.trials || [];
  console.log(
    JSON.stringify({
      i,
      runStatus: st.json.run?.status || st.json.status,
      trials: trials.map((t) => ({
        id: t.id,
        status: t.status,
        score: t.score,
        error: t.error?.slice?.(0, 400),
        externalId: t.externalId,
      })),
    }),
  );
  if (trials.some((t) => ["done", "error", "cancelled"].includes(t.status))) break;
}

const msg = await api("POST", `/auto/${autoRunId}/messages`, {
  content: "E2E: please acknowledge the Modal trial result and summarize the score.",
  role: "user",
  source: "api",
});
console.log(JSON.stringify({ message: msg.status, reply: msg.json }, null, 2));
