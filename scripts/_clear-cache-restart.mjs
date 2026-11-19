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
const h = {
  Authorization: `Bearer ${vars.BOX_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0",
};
async function put(path, content) {
  await fetch(`${base}/boxes/${boxId}/files`, {
    method: "PUT",
    headers: h,
    body: JSON.stringify({ path, content, encoding: "utf-8" }),
  });
  console.log("put", path);
}
async function cmd(c) {
  const r = await fetch(`${base}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ command: c }),
  });
  const j = await r.json();
  console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 1000));
}
await put(
  "trainfabric/autorunner_daemon.py",
  readFileSync(join(root, "services/autorunner/autorunner_daemon.py"), "utf8"),
);
await put("trainfabric/gateway.py", readFileSync(join(root, "services/autorunner/gateway.py"), "utf8"));
await put(
  "trainfabric/agent_mutate.py",
  readFileSync(join(root, "services/autorunner/agent_mutate.py"), "utf8"),
);
await put(
  "trainfabric/_restart.py",
  `#!/usr/bin/env python3
import os, signal, subprocess, time, shutil
from pathlib import Path
home = Path.home() / "trainfabric"
cache = home / "__pycache__"
if cache.exists():
    shutil.rmtree(cache)
    print("cleared pycache")
wrapper = home / "run_daemon.sh"
wrapper.write_text("""#!/bin/bash
export AUTORUN_SKIP_PROMPT=1
export PYTHONUNBUFFERED=1
export PYTHONDONTWRITEBYTECODE=1
exec python3 -u $HOME/trainfabric/autorunner_daemon.py
""")
wrapper.chmod(0o755)
for line in subprocess.getoutput("ps -eo pid,cmd").splitlines():
    if "trainfabric/autorunner_daemon.py" in line and "python" in line:
        os.kill(int(line.split()[0]), signal.SIGTERM)
        print("killed", line.split()[0])
time.sleep(1)
# sanity: gateway_configured should be False without httpx
import sys
sys.path.insert(0, str(home))
import gateway
print("httpx", gateway.httpx)
print("configured", gateway.gateway_configured())
log = open("/tmp/autorunner.log", "w")
p = subprocess.Popen([str(wrapper)], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
print("spawned", p.pid)
`,
);
await cmd("python3 ~/trainfabric/_restart.py");
await new Promise((r) => setTimeout(r, 25000));
await cmd(
  "cat /tmp/autorunner.log; echo ===; cd ~/repo && git log -5 --oneline; git diff --stat HEAD | head; echo ===; ls -la ~/repo/train.py",
);
