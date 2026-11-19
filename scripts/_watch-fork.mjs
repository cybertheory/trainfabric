#!/usr/bin/env node
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = "/tmp/tf-box-watch-fork.log";
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
const id = process.argv[2] || "bx_79d92m8t";

for (let i = 0; i < 75; i++) {
  const ac = AbortSignal.timeout(20_000);
  try {
    const res = await fetch(`${base}/boxes/${id}`, {
      headers: { Authorization: `Bearer ${vars.BOX_API_KEY}`, "User-Agent": "Mozilla/5.0" },
      signal: ac,
    });
    const j = await res.json();
    const b = j.box || j;
    log(`[${i}]`, b.state, "snap=", b.snapshotAvailable);
    if (["ready", "idle", "running"].includes(b.state)) {
      log("READY", id);
      // smoke
      const cmd = await fetch(`${base}/boxes/${id}/commands`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vars.BOX_API_KEY}`,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify({
          command:
            'echo GOLDEN_FORK_OK; ~/trainfabric/.venv/bin/python -c "import httpx; print(httpx.__version__)" 2>/dev/null || echo NO_HTTPX; test -x "$HOME/trainfabric/.venv/bin/tf" && echo TF_OK || echo TF_MISSING',
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const cj = await cmd.json().catch(() => ({}));
      log("cmd", cmd.status, JSON.stringify(cj).slice(0, 500));
      await fetch(`${base}/boxes/${id}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${vars.BOX_API_KEY}`, "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {});
      log("DONE_OK", { templateId: "bx_ckhpxtn3", forkId: id });
      process.exit(0);
    }
    if (["error", "destroyed", "deleted", "archived"].includes(b.state) && i > 2) {
      log("BAD_STATE", b.state);
      process.exit(1);
    }
  } catch (e) {
    log(`[${i}] err`, String(e));
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
log("TIMEOUT");
process.exit(2);
