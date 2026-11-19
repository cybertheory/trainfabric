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
const boxId = "bx_dnc77k33";
const src = readFileSync(join(root, "services/autorunner/agent_mutate.py"), "utf8");
const b64 = Buffer.from(src, "utf8").toString("base64");

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

console.log("status", await bcmd("ps aux | grep -E 'python3|propose' | grep -v grep | head -20"));
const w = await bcmd(
  `python3 -c "import base64,pathlib; p=pathlib.Path.home()/'trainfabric'/'agent_mutate.py'; p.write_bytes(base64.b64decode('${b64}')); print(p.stat().st_size)"`,
);
console.log("wrote", w.stdout || w.stderr);

const dry = await bcmd(`timeout 120 python3 - <<'PY' || echo TIMEOUT_OR_ERR
import os, sys, json, subprocess, time
from pathlib import Path
sys.path.insert(0, os.path.expanduser("~/trainfabric"))
import importlib, agent_mutate, gateway
importlib.reload(gateway); importlib.reload(agent_mutate)
repo = Path(os.path.expanduser("~/repo"))
tp = repo/"train.py"; bak = tp.read_text(encoding="utf-8")
protocol = {"metric":{"name":"val_bpb","direction":"min"},"budget":{"maxTrials":20,"maxWallClockSec":3600},"mutablePaths":["train.py"],"immutablePaths":["prepare.py","protocol.yaml"]}
t0=time.time()
try:
  out = agent_mutate.propose_mutate(repo_dir=repo, protocol=protocol, hypothesis="Use a slightly different linear weight to change score", trial_n=103, goal="lower val_bpb", steer=[], instructions="Improve fare model.")
  print("RESULT", json.dumps({"via": out.get("via"), "summary": (out.get("summary") or "")[:200], "files": out.get("files_touched"), "err": (str(out.get("gateway_error"))[:160] if out.get("gateway_error") else None), "secs": round(time.time()-t0,1)}))
  print("CHANGED", tp.read_text(encoding="utf-8") != bak)
finally:
  tp.write_text(bak, encoding="utf-8")
  subprocess.run(["git","checkout","--","train.py"], cwd=str(repo), check=False)
PY`);
console.log(dry.stdout || dry.stderr || JSON.stringify(dry).slice(0, 2000));
