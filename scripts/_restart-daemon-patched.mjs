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

async function bcmd(command) {
  const res = await fetch(`${boxBase}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ command }),
  });
  return res.json();
}

function patch(rel) {
  const src = readFileSync(join(root, "services/autorunner", rel), "utf8");
  const b64 = Buffer.from(src, "utf8").toString("base64");
  return `python3 -c "import base64,pathlib; p=pathlib.Path.home()/'trainfabric'/'${rel}'; p.write_bytes(base64.b64decode('${b64}')); print('wrote', '${rel}', p.stat().st_size)"`;
}

for (const f of ["agent_mutate.py", "gateway.py", "autorunner_daemon.py"]) {
  const out = await bcmd(patch(f));
  console.log(out.stdout || out.stderr || JSON.stringify(out).slice(0, 300));
}

const restart = await bcmd(`python3 - <<'PY'
import os, signal, subprocess, time
home = os.path.expanduser("~")
for p in subprocess.getoutput("pgrep -f trainfabric/autorunner_daemon.py|trainfabric/chat_shim.py").split():
    if p.isdigit():
        try: os.kill(int(p), signal.SIGTERM)
        except ProcessLookupError: pass
time.sleep(1)
subprocess.Popen(["python3", f"{home}/trainfabric/chat_shim.py"], stdout=open("/tmp/tf-chat.log","a"), stderr=subprocess.STDOUT, start_new_session=True)
subprocess.Popen(["python3", f"{home}/trainfabric/autorunner_daemon.py"], stdout=open("/tmp/autorunner.log","a"), stderr=subprocess.STDOUT, start_new_session=True)
time.sleep(2)
print(subprocess.getoutput("pgrep -af 'trainfabric/(autorunner_daemon|chat_shim).py' || true"))
print("--- log ---")
print(subprocess.getoutput("tail -n 15 /tmp/autorunner.log 2>/dev/null || true"))
PY`);
console.log(restart.stdout || restart.stderr || JSON.stringify(restart).slice(0, 1500));
