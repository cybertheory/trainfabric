#!/usr/bin/env node
/**
 * Smoke: mint agent JWT as rishabhspro, list datasets, start a tiny AutoRun.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { SignJWT } = createRequire(join(root, "services/router/package.json"))("jose");
const vars = Object.fromEntries(
  readFileSync(join(root, "services/router/.dev.vars"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const secret = vars.AGENT_TOKEN_SECRET;
if (!secret) throw new Error("AGENT_TOKEN_SECRET missing");
const base = (vars.PUBLIC_API_BASE || "https://trainfabric-router.rishabhspro.workers.dev").replace(
  /\/$/,
  "",
);

// Real Clerk user for rishabhspro@gmail.com (override with TF_USER_ID).
const subject = process.env.TF_USER_ID || "user_3H1i74IdIFMqzzZ5VpXd6YFVKGh";
const email = "rishabhspro@gmail.com";

const token = await new SignJWT({
  email,
  scope: ["datasets:read", "trainfabric"],
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(subject)
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(new TextEncoder().encode(secret));

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 800)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

console.log("whoami…");
const who = await api("GET", "/auth/whoami");
console.log(JSON.stringify(who, null, 2));

console.log("prerequisites…");
const autoList = await api("GET", "/auto");
console.log(
  JSON.stringify(
    {
      prerequisites: autoList.prerequisites,
      runs: (autoList.runs || []).slice(0, 3).map((r) => ({
        id: r.id,
        status: r.status,
        boxId: r.box?.boxId,
      })),
    },
    null,
    2,
  ),
);

console.log("datasets…");
const ds = await api("GET", "/datasets?limit=20&search=taxi");
const datasets = ds.datasets || [];
console.log(
  datasets.slice(0, 8).map((d) => ({
    id: d.id,
    name: d.name,
    owner: d.owner,
    rows: d.rowCount,
  })),
);

let datasetId =
  process.env.TF_DATASET_ID ||
  datasets.find((d) => /taxi|nyc/i.test(d.name || ""))?.id ||
  datasets[0]?.id;

if (!datasetId) {
  const all = await api("GET", "/datasets?limit=50");
  const list = all.datasets || [];
  console.log(
    "all datasets",
    list.slice(0, 10).map((d) => ({ id: d.id, name: d.name })),
  );
  datasetId = list[0]?.id;
}
if (!datasetId) throw new Error("No dataset available");

console.log("using dataset", datasetId);

// GitHub: list installations for this user if any
let installationId;
let repoFullName = process.env.TF_REPO || "cybertheory/tf-taxi-autoresearch";
try {
  const gh = await api("GET", "/github/installations");
  const inst = (gh.installations || gh || [])[0];
  if (inst?.installationId || inst?.id) {
    installationId = Number(inst.installationId || inst.id);
    console.log("github installation", installationId);
  }
} catch (e) {
  console.warn("github installations:", e.message);
}

const body = {
  goal: "Smoke test golden Box fork: make a tiny train.py tweak and report MAE on sample taxi data.",
  datasetId,
  protocol: {
    metric: { name: "mae", direction: "min" },
    budget: { maxTrials: 1, maxWallClockSec: 600, maxGpuSec: 120 },
    mutablePaths: ["train.py", "artifacts/**"],
    immutablePaths: ["protocol.yaml", "TRAINFABRIC.md"],
  },
  compute: { provider: "trainfabric_gpu" },
};

if (installationId) {
  body.installationId = installationId;
  body.repoFullName = repoFullName;
} else {
  body.repoUrl = `https://github.com/${repoFullName}`;
}

console.log("POST /auto", JSON.stringify(body, null, 2));
const run = await api("POST", "/auto", body);
console.log("created", JSON.stringify({ id: run.id, status: run.status, box: run.box }, null, 2));

writeFileSync(
  "/tmp/tf-smoke-autorun.json",
  JSON.stringify({ token, base, runId: run.id, datasetId, who }, null, 2),
);
console.log("wrote /tmp/tf-smoke-autorun.json");

// Poll a few times
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const detail = await api("GET", `/auto/${run.id}`);
  const r = detail.run || detail;
  console.log(
    `t+${(i + 1) * 5}s status=${r.status} box=${r.box?.boxId} phase_trials=${detail.trials?.length ?? 0} activity=${(detail.activity || []).slice(-1)[0]?.message || ""}`,
  );
  if (["error", "cancelled", "done"].includes(r.status)) break;
  if (r.box?.daemonHostUrl && i >= 2) {
    // send a chat steer
    try {
      const msg = await api("POST", `/auto/${run.id}/messages`, {
        content: "Smoke: acknowledge and prefer a tiny comment-only change if mutating.",
      });
      console.log("chat reply", JSON.stringify(msg).slice(0, 400));
    } catch (e) {
      console.warn("chat failed", e.message);
    }
  }
}
