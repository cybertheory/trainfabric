#!/usr/bin/env node
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = "/tmp/tf-box-resume-smoke.log";
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
const id = process.argv[2] || "bx_ckhpxtn3";
const headers = {
  Authorization: `Bearer ${vars.BOX_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0",
};

log("resume", id);
const resumeRes = await fetch(`${base}/boxes/${id}/resume`, {
  method: "POST",
  headers,
  body: JSON.stringify({ noEnv: true }),
  signal: AbortSignal.timeout(60_000),
}).catch((e) => ({ ok: false, status: 0, err: String(e) }));

if (resumeRes.err) {
  log("resume fetch err", resumeRes.err);
} else {
  const text = await resumeRes.text();
  log("resume", resumeRes.status, text.slice(0, 300));
}

for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`${base}/boxes/${id}`, {
      headers: { Authorization: headers.Authorization, "User-Agent": headers["User-Agent"] },
      signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json();
    const b = j.box || j;
    log(`[${i}]`, b.state, "snap=", b.snapshotAvailable);
    if (["ready", "idle", "running"].includes(b.state)) {
      log("RESUME_READY");
      const cmd = await fetch(`${base}/boxes/${id}/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          command: 'echo RESUME_OK; test -x "$HOME/trainfabric/.venv/bin/tf" && echo TF_OK || echo TF_MISSING',
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const cj = await cmd.json().catch(() => ({}));
      log("cmd", cmd.status, JSON.stringify(cj).slice(0, 400));
      // stop again so it remains archived template
      const stop = await fetch(`${base}/boxes/${id}/stop`, {
        method: "POST",
        headers: { Authorization: headers.Authorization, "User-Agent": headers["User-Agent"] },
        signal: AbortSignal.timeout(30_000),
      });
      log("stop", stop.status);
      log("DONE_RESUME_OK");
      process.exit(0);
    }
    if (["error", "destroyed", "deleted"].includes(b.state)) {
      log("BAD", b.state);
      process.exit(1);
    }
  } catch (e) {
    log(`[${i}] err`, String(e));
  }
  await new Promise((r) => setTimeout(r, 8_000));
}
log("RESUME_TIMEOUT");
process.exit(2);
