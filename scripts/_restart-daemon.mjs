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
const daemonSrc = readFileSync(join(root, "services/autorunner/autorunner_daemon.py"), "utf8");

async function cmd(command) {
  const res = await fetch(`${base}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ command }),
  });
  const j = await res.json();
  console.log("---", command.slice(0, 90));
  console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 600));
  return j;
}

console.log("rewrite daemon…");
await fetch(`${base}/boxes/${boxId}/files`, {
  method: "PUT",
  headers: h,
  body: JSON.stringify({
    path: "trainfabric/autorunner_daemon.py",
    content: daemonSrc,
    encoding: "utf-8",
  }),
}).then(async (r) => console.log("put", r.status, (await r.text()).slice(0, 120)));

await cmd("grep -n 'TrainfabricAutorunner' ~/trainfabric/autorunner_daemon.py | head -2");
await cmd(
  "python3 <<'PY'\nimport os, signal, subprocess, time\nfrom pathlib import Path\nout=subprocess.getoutput(\"ps -eo pid,cmd\")\nfor line in out.splitlines():\n    if 'trainfabric/autorunner_daemon.py' in line and 'python' in line:\n        pid=int(line.split()[0]); os.kill(pid, signal.SIGTERM); print('killed', pid)\ntime.sleep(1)\nlog=open('/tmp/autorunner.log','w')\np=subprocess.Popen(['python3', str(Path.home()/'trainfabric/autorunner_daemon.py')], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)\nprint('spawned', p.pid)\nPY",
);
await new Promise((r) => setTimeout(r, 8000));
await cmd("ps -eo pid,cmd | grep trainfabric | grep -v grep");
await cmd("tail -n 100 /tmp/autorunner.log");
