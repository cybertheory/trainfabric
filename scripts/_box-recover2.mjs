#!/usr/bin/env node
/**
 * Single-shot Box recover: stop live golden, cancel stuck forks, one fork, wait long.
 * Logs unbuffered to /tmp/tf-box-recover2.log
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = "/tmp/tf-box-recover2.log";
writeFileSync(LOG, "");
const log = (...args) => {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  appendFileSync(LOG, line + "\n");
  process.stdout.write(line + "\n");
};

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

async function listBoxes() {
  const r = await req("GET", "/boxes", undefined, 30_000);
  return r.json.boxes || r.json.data || [];
}

async function waitState(id, okStates, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await req("GET", `/boxes/${id}`, undefined, 20_000);
    const b = boxOf(r.json);
    log(`[${label}]`, id, "state=", b?.state, "snap=", b?.snapshotAvailable);
    if (okStates.includes(b?.state)) return b;
    if (["error", "destroyed", "deleted"].includes(b?.state)) {
      throw new Error(`${id} ended in ${b.state}`);
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error(`timeout waiting ${label} for ${id}`);
}

log("step1 inventory");
let boxes = await listBoxes();
log({
  boxCount: boxes.length,
  byState: boxes.reduce((a, b) => ((a[b.state] = (a[b.state] || 0) + 1), a), {}),
});

log("step2 cancel stuck provisioning");
for (const b of boxes.filter((x) => /provision|clon/i.test(String(x.state)))) {
  for (const action of ["interrupt", "stop"]) {
    try {
      const r = await req("POST", `/boxes/${b.id}/${action}`, undefined, 20_000);
      log(b.id, action, r.status, JSON.stringify(r.json).slice(0, 120));
    } catch (e) {
      log(b.id, action, "err", String(e));
    }
  }
  for (const path of [`/boxes/${b.id}`, `/boxes/${b.id}/remove`]) {
    try {
      const r = await req("DELETE", path, undefined, 20_000);
      log(b.id, "DELETE", path, r.status, JSON.stringify(r.json).slice(0, 120));
      if (r.status < 400) break;
    } catch (e) {
      log(b.id, "DELETE", path, String(e));
    }
  }
  try {
    const r = await req("POST", `/boxes/${b.id}/remove`, undefined, 20_000);
    log(b.id, "POST remove", r.status, JSON.stringify(r.json).slice(0, 120));
  } catch (e) {
    log(b.id, "POST remove", String(e));
  }
}

log("step3 stop idle golden so only archived template remains");
const IDLE = "bx_4x53uk6q";
const ARCHIVED = "bx_ckhpxtn3";
try {
  const idle = boxOf((await req("GET", `/boxes/${IDLE}`, undefined, 20_000)).json);
  log("idle", idle?.state, idle?.snapshotAvailable);
  if (["idle", "ready", "running", "provisioning"].includes(idle?.state)) {
    const stop = await req("POST", `/boxes/${IDLE}/stop`, undefined, 30_000);
    log("stop idle", stop.status, JSON.stringify(stop.json).slice(0, 160));
    await waitState(IDLE, ["archived"], 180_000, "archive-idle").catch((e) => log(String(e)));
  }
} catch (e) {
  log("idle stop err", String(e));
}

const tmpl = boxOf((await req("GET", `/boxes/${ARCHIVED}`, undefined, 20_000)).json);
log("template", ARCHIVED, tmpl?.state, "snap=", tmpl?.snapshotAvailable);
if (!(tmpl?.snapshotAvailable && tmpl?.state === "archived")) {
  // fall back to idle if it archived with snap
  const idle2 = boxOf((await req("GET", `/boxes/${IDLE}`, undefined, 20_000)).json);
  log("fallback idle", idle2?.state, idle2?.snapshotAvailable);
}

const templateId =
  tmpl?.snapshotAvailable && tmpl?.state === "archived"
    ? ARCHIVED
    : IDLE;

log("step4 wait 20s for fleet to settle");
await new Promise((r) => setTimeout(r, 20_000));

log("step5 single fork", templateId);
let forkId = null;
try {
  const fork = await req("POST", `/boxes/${templateId}/fork`, { noEnv: true }, 90_000);
  log("fork", fork.status, JSON.stringify(fork.json).slice(0, 400));
  forkId = boxOf(fork.json)?.id;
} catch (e) {
  log("fork POST timed out/err", String(e));
  // maybe fork still created — find newest provisioning golden fork
  boxes = await listBoxes();
  const newest = boxes
    .filter((b) => /golden fork/i.test(String(b.name || "")) && /provision|ready|idle/i.test(String(b.state)))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  log("newest candidate", newest);
  forkId = newest?.id || null;
}

if (!forkId) {
  log("FATAL no fork id");
  process.exit(1);
}

log("step6 wait fork ready", forkId);
const ready = await waitState(forkId, ["ready", "idle", "running"], 600_000, "fork-ready");

log("step7 smoke cmd");
try {
  const cmd = await req(
    "POST",
    `/boxes/${forkId}/commands`,
    {
      command:
        'echo GOLDEN_FORK_OK; ~/trainfabric/.venv/bin/python -c "import httpx; print(httpx.__version__)" 2>/dev/null || echo NO_HTTPX; test -x "$HOME/trainfabric/.venv/bin/tf" && echo TF_OK || echo TF_MISSING',
    },
    120_000,
  );
  log("cmd", cmd.status, JSON.stringify(cmd.json).slice(0, 600));
} catch (e) {
  log("cmd err", String(e));
}

log("step8 stop fork");
try {
  log("stopFork", (await req("POST", `/boxes/${forkId}/stop`, undefined, 30_000)).status);
} catch (e) {
  log("stopFork err", String(e));
}

if (vars.BOX_TEMPLATE_ID !== templateId) {
  const raw = readFileSync(varsPath, "utf8");
  const next = raw.includes("BOX_TEMPLATE_ID=")
    ? raw.replace(/BOX_TEMPLATE_ID=.*/m, `BOX_TEMPLATE_ID=${templateId}`)
    : `${raw.trimEnd()}\nBOX_TEMPLATE_ID=${templateId}\n`;
  writeFileSync(varsPath, next);
  log("updated .dev.vars BOX_TEMPLATE_ID=", templateId);
} else {
  log("BOX_TEMPLATE_ID already", templateId);
}

log("DONE", { ok: true, templateId, forkId, forkState: ready?.state });
