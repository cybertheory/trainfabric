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
const boxBase = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const boxId = process.argv[2] || "bx_dnc77k33";

const res = await fetch(`${boxBase}/boxes/${boxId}/commands`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${vars.BOX_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
  },
  body: JSON.stringify({
    command: `python3 - <<'PY'
import os, signal, subprocess, time
home = os.path.expanduser("~")
for pat in ("trainfabric/autorunner_daemon.py", "trainfabric/chat_shim.py"):
    for p in subprocess.getoutput(f"pgrep -f {pat}").split():
        if p.isdigit():
            try:
                os.kill(int(p), signal.SIGKILL)
            except ProcessLookupError:
                pass
time.sleep(1)
subprocess.Popen(
    ["python3", f"{home}/trainfabric/chat_shim.py"],
    stdout=open("/tmp/tf-chat.log", "a"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
subprocess.Popen(
    ["python3", "-u", f"{home}/trainfabric/autorunner_daemon.py"],
    stdout=open("/tmp/autorunner.log", "a"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
time.sleep(2)
print(subprocess.getoutput("pgrep -af 'trainfabric/(autorunner_daemon|chat_shim).py' || true"))
print("---")
print(subprocess.getoutput("tail -n 8 /tmp/autorunner.log 2>/dev/null || true"))
PY`,
  }),
});
const j = await res.json();
console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 1500));
