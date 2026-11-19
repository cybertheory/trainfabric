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
const boxId = process.argv[2] || "bx_q3m6hdaj";
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const h = {
  Authorization: `Bearer ${vars.BOX_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0",
};

async function put(path, content) {
  const r = await fetch(`${base}/boxes/${boxId}/files`, {
    method: "PUT",
    headers: h,
    body: JSON.stringify({ path, content, encoding: "utf-8" }),
  });
  const t = await r.text();
  console.log("put", path, r.status, t.slice(0, 80));
}

async function cmd(command) {
  const r = await fetch(`${base}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ command }),
  });
  const j = await r.json();
  console.log("---", command.slice(0, 90));
  console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 800));
  return j;
}

const restartPy = `#!/usr/bin/env python3
import os, signal, subprocess, time
from pathlib import Path
home = Path.home()
wrapper = home / "trainfabric/run_daemon.sh"
wrapper.write_text("""#!/bin/bash
export AUTORUN_SKIP_PROMPT=1
export PYTHONUNBUFFERED=1
exec python3 $HOME/trainfabric/autorunner_daemon.py
""")
wrapper.chmod(0o755)
out = subprocess.getoutput("ps -eo pid,cmd")
for line in out.splitlines():
    if "trainfabric/autorunner_daemon.py" in line and "python" in line:
        os.kill(int(line.split()[0]), signal.SIGTERM)
        print("killed", line.split()[0])
time.sleep(1)
log = open("/tmp/autorunner.log", "w")
p = subprocess.Popen([str(wrapper)], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
print("spawned", p.pid)
`;

await put(
  "trainfabric/autorunner_daemon.py",
  readFileSync(join(root, "services/autorunner/autorunner_daemon.py"), "utf8"),
);
await put("trainfabric/gateway.py", readFileSync(join(root, "services/autorunner/gateway.py"), "utf8"));
await put("trainfabric/_restart.py", restartPy);
await cmd("python3 ~/trainfabric/_restart.py");
await new Promise((r) => setTimeout(r, 20000));
await cmd(
  "tail -n 120 /tmp/autorunner.log; echo ===; cd ~/repo && git log -5 --oneline; git status -sb | head -10; echo ===; ps -eo pid,etime,cmd | grep trainfabric | grep -v grep",
);
