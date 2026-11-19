#!/usr/bin/env node
/** Push updated autorunner to a live Box and restart (skip prompt). */
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
const boxId = process.argv[2];
if (!boxId) throw new Error("usage: push-daemon-to-box.mjs <boxId>");
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
  console.log("put", path, r.status);
}

async function cmd(command) {
  const r = await fetch(`${base}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ command }),
  });
  const j = await r.json();
  console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 600));
}

await put(
  "trainfabric/autorunner_daemon.py",
  readFileSync(join(root, "services/autorunner/autorunner_daemon.py"), "utf8"),
);
await put("trainfabric/gateway.py", readFileSync(join(root, "services/autorunner/gateway.py"), "utf8"));
await put(
  "trainfabric/_restart.py",
  `#!/usr/bin/env python3
import os, signal, subprocess, time, shutil
from pathlib import Path
home = Path.home() / "trainfabric"
cache = home / "__pycache__"
if cache.exists():
    shutil.rmtree(cache)
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
log = open("/tmp/autorunner.log", "w")
p = subprocess.Popen([str(wrapper)], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
print("spawned", p.pid)
`,
);
await cmd("python3 ~/trainfabric/_restart.py");
await new Promise((r) => setTimeout(r, 8000));
await cmd("tail -n 40 /tmp/autorunner.log");
