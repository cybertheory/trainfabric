#!/usr/bin/env node
/**
 * Delete stuck fork, single fire-and-forget fork, poll until ready, smoke, stop.
 */
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = "/tmp/tf-box-single-fork.log";
writeFileSync(LOG, "");
const log = (...a) => {
  const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  appendFileSync(LOG, line + "\n");
  console.log(line);
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vars = Object.fromEntries(
  readFileSync(join(root, "services/router/.dev.vars"), "utf8")
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
const TEMPLATE = vars.BOX_TEMPLATE_ID || "bx_ckhpxtn3";

async function get(id) {
  const res = await fetch(`${base}/boxes/${id}`, {
    headers: { Authorization: headers.Authorization, "User-Agent": headers["User-Agent"] },
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: res.status, raw: text.slice(0, 200) };
  }
  return { status: res.status, box: json.box || json };
}

async function del(id) {
  for (const action of ["stop", "interrupt"]) {
    try {
      const r = await fetch(`${base}/boxes/${id}/${action}`, {
        method: "POST",
        headers: { Authorization: headers.Authorization, "User-Agent": headers["User-Agent"] },
        signal: AbortSignal.timeout(20_000),
      });
      log(id, action, r.status);
    } catch (e) {
      log(id, action, String(e));
    }
  }
  try {
    const r = await fetch(`${base}/boxes/${id}`, {
      method: "DELETE",
      headers: { Authorization: headers.Authorization, "User-Agent": headers["User-Agent"] },
      signal: AbortSignal.timeout(20_000),
    });
    log(id, "DELETE", r.status, (await r.text()).slice(0, 120));
  } catch (e) {
    log(id, "DELETE", String(e));
  }
}

const stuck = process.argv[2] || "bx_79d92m8t";
log("delete stuck", stuck);
await del(stuck);

log("template check", TEMPLATE);
const tmpl = await get(TEMPLATE);
log("template", tmpl);

if (tmpl.box?.state !== "archived" || !tmpl.box?.snapshotAvailable) {
  log("FATAL template not forkable");
  process.exit(1);
}

log("settle 15s");
await new Promise((r) => setTimeout(r, 15_000));

// Snapshot boxes before fork
const before = await fetch(`${base}/boxes`, {
  headers: { Authorization: headers.Authorization, "User-Agent": headers["User-Agent"] },
  signal: AbortSignal.timeout(30_000),
}).then((r) => r.json());
const beforeIds = new Set((before.boxes || before.data || []).map((b) => b.id));
log("beforeCount", beforeIds.size);

log("fire-and-forget fork POST");
const forkPromise = fetch(`${base}/boxes/${TEMPLATE}/fork`, {
  method: "POST",
  headers,
  body: JSON.stringify({ noEnv: true }),
}).then(async (r) => {
  const text = await r.text();
  log("fork POST eventually", r.status, text.slice(0, 300));
  return text;
}).catch((e) => log("fork POST err", String(e)));

// Don't await fork POST — discover new box via list
let forkId = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5_000));
  try {
    const list = await fetch(`${base}/boxes`, {
      headers: { Authorization: headers.Authorization, "User-Agent": headers["User-Agent"] },
      signal: AbortSignal.timeout(30_000),
    }).then((r) => r.json());
    const boxes = list.boxes || list.data || [];
    const fresh = boxes
      .filter((b) => !beforeIds.has(b.id) && /golden fork/i.test(String(b.name || "")))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (fresh) {
      forkId = fresh.id;
      log("discovered fork", forkId, fresh.state);
      break;
    }
    log(`[discover ${i}] no new fork yet; boxes=${boxes.length}`);
  } catch (e) {
    log(`[discover ${i}]`, String(e));
  }
}

if (!forkId) {
  log("FATAL no fork discovered");
  await forkPromise;
  process.exit(1);
}

for (let i = 0; i < 90; i++) {
  try {
    const g = await get(forkId);
    const st = g.box?.state;
    log(`[wait ${i}]`, st, "snap=", g.box?.snapshotAvailable);
    if (["ready", "idle", "running"].includes(st)) {
      log("READY");
      const cmd = await fetch(`${base}/boxes/${forkId}/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          command:
            'echo GOLDEN_FORK_OK; ~/trainfabric/.venv/bin/python -c "import httpx; print(httpx.__version__)" 2>/dev/null || echo NO_HTTPX; test -x "$HOME/trainfabric/.venv/bin/tf" && echo TF_OK || echo TF_MISSING',
        }),
        signal: AbortSignal.timeout(120_000),
      });
      log("cmd", cmd.status, (await cmd.text()).slice(0, 500));
      await fetch(`${base}/boxes/${forkId}/stop`, {
        method: "POST",
        headers: { Authorization: headers.Authorization, "User-Agent": headers["User-Agent"] },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {});
      log("DONE_OK", { templateId: TEMPLATE, forkId });
      process.exit(0);
    }
    if (["error", "destroyed", "deleted", "archived"].includes(st) && i > 3) {
      log("BAD_STATE", st);
      process.exit(1);
    }
  } catch (e) {
    log(`[wait ${i}] err`, String(e));
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
log("TIMEOUT");
process.exit(2);
