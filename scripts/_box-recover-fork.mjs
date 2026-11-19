#!/usr/bin/env node
/**
 * Recover forkable golden: prefer idle golden, stop if needed, fork with hard timeout.
 * Usage: node scripts/_box-recover-fork.mjs [templateId]
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

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function req(method, path, body, timeoutMs = 30_000) {
  const doFetch = async () => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, json };
  };
  return withTimeout(doFetch(), timeoutMs, `${method} ${path}`);
}

function boxOf(j) {
  return j?.box || j?.data || j;
}

async function waitReady(id, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await req("GET", `/boxes/${id}`, undefined, 20_000);
    const b = boxOf(r.json);
    console.log(`[wait] ${id} state=${b?.state} snap=${b?.snapshotAvailable}`);
    if (["ready", "idle", "running"].includes(b?.state)) return b;
    if (["error", "destroyed", "deleted"].includes(b?.state)) {
      throw new Error(`${id} ended in ${b.state}`);
    }
    await new Promise((r) => setTimeout(r, 4_000));
  }
  throw new Error(`timeout waiting for ${id}`);
}

// inventory
const list = await req("GET", "/boxes", undefined, 30_000);
const boxes = list.json.boxes || list.json.data || [];
const byState = {};
for (const b of boxes) byState[b.state] = (byState[b.state] || 0) + 1;
console.log(JSON.stringify({ boxCount: boxes.length, byState }, null, 2));

// Prefer idle golden with snapshot, else archived with snapshot
const goldens = boxes.filter((b) => /autorunner-golden/i.test(String(b.name || "")));
const idleGolden = goldens.find((b) => b.state === "idle" && b.snapshotAvailable);
const archivedGolden = goldens.find(
  (b) => b.state === "archived" && b.snapshotAvailable && !/fork/i.test(String(b.name || "")),
);
const argId = process.argv[2];
let templateId = argId || idleGolden?.id || archivedGolden?.id || vars.BOX_TEMPLATE_ID || "bx_ckhpxtn3";
console.log("candidates", {
  idleGolden: idleGolden && { id: idleGolden.id, state: idleGolden.state },
  archivedGolden: archivedGolden && { id: archivedGolden.id, state: archivedGolden.state },
  templateId,
});

const get = await req("GET", `/boxes/${templateId}`, undefined, 20_000);
const tmpl = boxOf(get.json);
console.log("template", { id: templateId, state: tmpl?.state, snap: tmpl?.snapshotAvailable, name: tmpl?.name });

// If live, stop to keep as archived template after fork test — but fork first while idle/ready if possible
async function tryFork(id, label) {
  console.log(`\n=== fork ${label} ${id} ===`);
  try {
    const fork = await req("POST", `/boxes/${id}/fork`, { noEnv: true }, 45_000);
    console.log("fork response", fork.status, JSON.stringify(fork.json).slice(0, 500));
    const fb = boxOf(fork.json);
    if (fork.status >= 400 || !fb?.id) return null;
    return fb;
  } catch (e) {
    console.error("fork error", String(e));
    return null;
  }
}

let forkBox = await tryFork(templateId, "primary");

if (!forkBox && templateId !== idleGolden?.id && idleGolden?.id) {
  templateId = idleGolden.id;
  forkBox = await tryFork(templateId, "idle-golden");
}

if (!forkBox && templateId !== archivedGolden?.id && archivedGolden?.id) {
  templateId = archivedGolden.id;
  forkBox = await tryFork(templateId, "archived-golden");
}

if (!forkBox) {
  console.log("\n=== fork failed; resume archived golden ===");
  const resumeId = archivedGolden?.id || "bx_ckhpxtn3";
  try {
    const resume = await req("POST", `/boxes/${resumeId}/resume`, { noEnv: true }, 45_000);
    console.log("resume", resume.status, JSON.stringify(resume.json).slice(0, 400));
    await waitReady(resumeId, 180_000);
    forkBox = await tryFork(resumeId, "after-resume");
    templateId = resumeId;
  } catch (e) {
    console.error("resume path failed", String(e));
  }
}

if (!forkBox?.id) {
  console.error("FATAL: could not fork any golden");
  process.exit(1);
}

const forkId = forkBox.id;
console.log(`\n=== wait fork ready ${forkId} ===`);
const ready = await waitReady(forkId, 240_000);

console.log("\n=== smoke command ===");
try {
  const cmd = await req(
    "POST",
    `/boxes/${forkId}/commands`,
    {
      command:
        "echo GOLDEN_FORK_OK; which python3; test -x \"$HOME/trainfabric/.venv/bin/tf\" && echo TF_OK || echo TF_MISSING",
    },
    90_000,
  );
  console.log("cmd", cmd.status, JSON.stringify(cmd.json).slice(0, 600));
} catch (e) {
  console.error("cmd failed", String(e));
}

console.log("\n=== stop fork ===");
try {
  const stop = await req("POST", `/boxes/${forkId}/stop`, undefined, 30_000);
  console.log("stopFork", stop.status);
} catch (e) {
  console.error("stopFork", String(e));
}

// Ensure template is archived with snapshot (stop idle golden if we used it live)
const tmplNow = boxOf((await req("GET", `/boxes/${templateId}`, undefined, 20_000)).json);
if (["idle", "ready", "running"].includes(tmplNow?.state)) {
  console.log("\n=== stop template to archive for future forks ===");
  try {
    const stop = await req("POST", `/boxes/${templateId}/stop`, undefined, 30_000);
    console.log("stopTemplate", stop.status);
    for (let i = 0; i < 24; i++) {
      const b = boxOf((await req("GET", `/boxes/${templateId}`, undefined, 20_000)).json);
      console.log(`[archiving] ${templateId} state=${b?.state} snap=${b?.snapshotAvailable}`);
      if (b?.state === "archived" && b?.snapshotAvailable) break;
      await new Promise((r) => setTimeout(r, 5_000));
    }
  } catch (e) {
    console.error("stopTemplate", String(e));
  }
}

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

console.log(JSON.stringify({ ok: true, templateId, forkId, forkState: ready?.state }, null, 2));
