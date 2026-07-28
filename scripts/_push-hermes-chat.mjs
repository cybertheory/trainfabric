#!/usr/bin/env node
/** Push Hermes chat stack to a Box and restart chat_shim + daemon. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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
if (!boxId) throw new Error("usage: push-hermes-chat.mjs <boxId>");
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const h = {
  Authorization: `Bearer ${vars.BOX_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0",
};
const ar = join(root, "services/autorunner");

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
  console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 800));
  return j;
}

for (const f of ["chat_reply.py", "chat_shim.py", "gateway.py", "autorunner_daemon.py"]) {
  await put(`trainfabric/${f}`, readFileSync(join(ar, f), "utf8"));
}

await cmd(
  "python3 -m pip install --break-system-packages -q httpx 2>&1 | tail -5; python3 -c 'import httpx; print(\"httpx\", httpx.__version__)' 2>&1",
);

const restartPy = `#!/usr/bin/env python3
import os, signal, subprocess, time, shutil
from pathlib import Path
home = Path.home() / "trainfabric"
cache = home / "__pycache__"
if cache.exists():
    shutil.rmtree(cache)
for line in subprocess.getoutput("ps -eo pid,cmd").splitlines():
    if ("trainfabric/chat_shim.py" in line or "trainfabric/autorunner_daemon.py" in line) and "python" in line:
        os.kill(int(line.split()[0]), signal.SIGTERM)
        print("killed", line.split()[0])
time.sleep(1)
env = {**os.environ, "PYTHONUNBUFFERED": "1", "AUTORUN_SKIP_PROMPT": "1"}
subprocess.Popen(["python3", str(home / "chat_shim.py")], stdout=open("/tmp/tf-chat.log", "w"), stderr=subprocess.STDOUT, start_new_session=True, env=env)
subprocess.Popen(["python3", "-u", str(home / "autorunner_daemon.py")], stdout=open("/tmp/autorunner.log", "w"), stderr=subprocess.STDOUT, start_new_session=True, env=env)
print("spawned")
`;
await put("trainfabric/_restart_chat.py", restartPy);
await cmd("python3 ~/trainfabric/_restart_chat.py");
await new Promise((r) => setTimeout(r, 6000));
await cmd(
  "ps -eo pid,cmd | grep trainfabric | grep -v grep; echo ---; curl -sS -m 8 http://127.0.0.1:8787/health; echo; python3 -c 'import chat_reply,gateway; print(\"imports ok\", gateway.gateway_configured())'",
);
