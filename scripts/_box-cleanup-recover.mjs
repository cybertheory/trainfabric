#!/usr/bin/env node
/**
 * Cleanup stuck provisioning boxes, verify golden template, fork-smoke.
 * Usage: node scripts/_box-cleanup-recover.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const varsPath = join(root, "services/router/.dev.vars");
const vars = Object.fromEntries(
  readFileSync(varsPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const headers = {
  Authorization: `Bearer ${vars.BOX_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0",
};

async function req(method, path, body, timeoutMs = 45_000) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

function boxOf(j) {
  return j?.box || j?.data || j;
}

async function waitReady(id, label, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await req("GET", `/boxes/${id}`);
    const b = boxOf(r.json);
    const state = b?.state;
    console.log(`[wait ${label}] ${id} status=${r.status} state=${state} snap=${b?.snapshotAvailable}`);
    if (["ready", "idle", "running"].includes(state)) return b;
    if (["error", "destroyed", "deleted"].includes(state)) {
      throw new Error(`${id} ended in ${state}`);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`timeout waiting for ${id} (${label})`);
}

const list = await req("GET", "/boxes");
const boxes = list.json.boxes || list.json.data || [];
const provisioning = boxes.filter((b) => /provision|clon/i.test(String(b.state)));
console.log(
  JSON.stringify(
    {
      boxCount: boxes.length,
      byState: boxes.reduce((acc, b) => {
        acc[b.state] = (acc[b.state] || 0) + 1;
        return acc;
      }, {}),
      provisioning: provisioning.map((b) => ({ id: b.id, state: b.state, name: b.name })),
    },
    null,
    2,
  ),
);

console.log("\n=== cleanup stuck provisioning ===");
for (const b of provisioning) {
  const id = b.id;
  for (const action of ["interrupt", "stop"]) {
    const r = await req("POST", `/boxes/${id}/${action}`);
    console.log(id, action, r.status, JSON.stringify(r.json).slice(0, 160));
  }
  for (const path of [`/boxes/${id}`, `/boxes/${id}/remove`, `/boxes/${id}/delete`]) {
    const r = await req("DELETE", path);
    console.log(id, "DELETE", path, r.status, JSON.stringify(r.json).slice(0, 160));
    if (r.status < 400) break;
  }
  // some APIs use POST remove
  const rem = await req("POST", `/boxes/${id}/remove`);
  console.log(id, "POST /remove", rem.status, JSON.stringify(rem.json).slice(0, 160));
}

console.log("\n=== candidate goldens ===");
const preferred = [
  vars.BOX_TEMPLATE_ID,
  "bx_ckhpxtn3",
  "bx_4x53uk6q",
  "bx_5grk9g39",
].filter(Boolean);
const seen = new Set();
const candidates = [];
for (const id of preferred) {
  if (seen.has(id)) continue;
  seen.add(id);
  const r = await req("GET", `/boxes/${id}`);
  const b = boxOf(r.json);
  candidates.push({
    id,
    status: r.status,
    state: b?.state,
    snapshotAvailable: b?.snapshotAvailable,
    name: b?.name,
  });
}
console.log(JSON.stringify(candidates, null, 2));

// Prefer archived+snapshot or idle golden
let templateId =
  candidates.find((c) => c.state === "archived" && c.snapshotAvailable)?.id ||
  candidates.find((c) => ["idle", "ready"].includes(c.state) && c.snapshotAvailable)?.id ||
  candidates.find((c) => c.snapshotAvailable)?.id;

if (!templateId) {
  console.error("No forkable golden found");
  process.exit(1);
}

console.log(`\n=== using template ${templateId} ===`);

// If idle/ready without wanting a live machine forever, stop to ensure snapshot template.
const tmpl = candidates.find((c) => c.id === templateId);
if (tmpl && ["idle", "ready", "running"].includes(tmpl.state)) {
  console.log("stopping live golden to ensure archived snapshot template...");
  const stop = await req("POST", `/boxes/${templateId}/stop`);
  console.log("stop", stop.status, JSON.stringify(stop.json).slice(0, 200));
  // wait for archived
  for (let i = 0; i < 36; i++) {
    const r = await req("GET", `/boxes/${templateId}`);
    const b = boxOf(r.json);
    console.log(`[archiving] state=${b?.state} snap=${b?.snapshotAvailable}`);
    if (b?.state === "archived" && b?.snapshotAvailable) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

// Fork smoke
console.log("\n=== fork smoke ===");
const fork = await req("POST", `/boxes/${templateId}/fork`, { noEnv: true }, 60_000);
console.log("fork", fork.status, JSON.stringify(fork.json).slice(0, 400));
const forkBox = boxOf(fork.json);
const forkId = forkBox?.id;
if (!forkId || fork.status >= 400) {
  // try resume archived golden instead
  console.log("\n=== fork failed; trying resume of archived golden ===");
  const resume = await req("POST", `/boxes/${templateId}/resume`, { noEnv: true });
  console.log("resume", resume.status, JSON.stringify(resume.json).slice(0, 300));
  const resumed = boxOf(resume.json);
  if (resumed?.id) {
    try {
      const ready = await waitReady(resumed.id || templateId, "resume", 240_000);
      console.log("resume ready", ready.id, ready.state);
      // stop again so it remains a template
      await req("POST", `/boxes/${templateId}/stop`);
    } catch (e) {
      console.error(String(e));
    }
  }
  process.exit(fork.status >= 400 ? 1 : 0);
}

let readyFork;
try {
  readyFork = await waitReady(forkId, "fork", 240_000);
} catch (e) {
  console.error(String(e));
  process.exit(1);
}

console.log("\n=== fork ready; quick command ===");
const cmd = await req(
  "POST",
  `/boxes/${forkId}/commands`,
  { command: "echo GOLDEN_FORK_OK && which python3 && test -x $HOME/trainfabric/.venv/bin/tf && echo TF_OK || echo TF_MISSING" },
  90_000,
);
console.log("cmd", cmd.status, JSON.stringify(cmd.json).slice(0, 500));

console.log("\n=== stop fork ===");
const stopFork = await req("POST", `/boxes/${forkId}/stop`);
console.log("stopFork", stopFork.status);

// Update .dev.vars BOX_TEMPLATE_ID if needed
if (vars.BOX_TEMPLATE_ID !== templateId) {
  const raw = readFileSync(varsPath, "utf8");
  const next = raw.includes("BOX_TEMPLATE_ID=")
    ? raw.replace(/BOX_TEMPLATE_ID=.*/m, `BOX_TEMPLATE_ID=${templateId}`)
    : `${raw.trimEnd()}\nBOX_TEMPLATE_ID=${templateId}\n`;
  writeFileSync(varsPath, next);
  console.log(`updated .dev.vars BOX_TEMPLATE_ID=${templateId}`);
} else {
  console.log(`BOX_TEMPLATE_ID already ${templateId}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      templateId,
      forkId,
      forkState: readyFork?.state,
    },
    null,
    2,
  ),
);
