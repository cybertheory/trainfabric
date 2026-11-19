#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
const boxId = "bx_q3m6hdaj";
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const r = await fetch(`${base}/boxes/${boxId}/commands`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${vars.BOX_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
  },
  body: JSON.stringify({
    command: [
      "ps -eo pid,etime,cmd | grep -E 'autorunner|run_daemon' | grep -v grep",
      "grep -n AUTORUN_SKIP_PROMPT ~/trainfabric/autorunner_daemon.py | head",
      "grep -n 'httpx is None' ~/trainfabric/gateway.py | head",
      "tr '\\0' '\\n' < /proc/$(pgrep -f 'autorunner_daemon.py' | head -1)/environ 2>/dev/null | grep -E 'AUTORUN_SKIP|CF_AI' | sed 's/=.*/=…/' || echo no_environ",
      "ls -la /proc/$(pgrep -f 'autorunner_daemon.py' | head -1)/fd 2>/dev/null | head -20 || true",
      "wc -l /tmp/autorunner.log; cat /tmp/autorunner.log",
      "cd ~/repo && git log -3 --oneline; git diff --stat HEAD | head",
    ].join("; echo '----'; "),
  }),
});
const j = await r.json();
console.log(j.stdout || j.stderr || JSON.stringify(j));
