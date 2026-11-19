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
import os, sys, json, traceback
from pathlib import Path
sys.path.insert(0, os.path.expanduser("~/trainfabric"))

# 1) daemon process env
import subprocess
ps = subprocess.getoutput("pgrep -af autorunner_daemon.py")
print("procs:", ps)
pids = [p for p in subprocess.getoutput("pgrep -f trainfabric/autorunner_daemon.py").split() if p.isdigit()]
for pid in pids[:2]:
    try:
        env = Path(f"/proc/{pid}/environ").read_bytes().split(b"\\0")
        keys = {}
        for e in env:
            if b"=" not in e: continue
            k,v = e.split(b"=",1)
            ks = k.decode()
            if ks.startswith(("CF_","AUTORUN","TF_","PROTOCOL")):
                keys[ks] = ("set("+str(len(v))+")" if b"TOKEN" in k or ks=="TF_TOKEN" else v.decode()[:60])
        print("daemon_env", pid, json.dumps(keys))
    except Exception as e:
        print("daemon_env err", pid, e)

# 2) dry-run propose_mutate against repo
repo = Path(os.path.expanduser("~/repo"))
print("repo_exists", repo.is_dir(), "train.py", (repo/"train.py").exists())
protocol = {
  "metric": {"name":"val_bpb","direction":"min"},
  "budget": {"maxTrials":20,"maxWallClockSec":3600},
  "mutablePaths":["train.py"],
  "immutablePaths":["prepare.py","protocol.yaml"],
}
try:
    from agent_mutate import propose_mutate
    # backup train.py
    tp = repo/"train.py"
    bak = tp.read_text(encoding="utf-8") if tp.exists() else None
    out = propose_mutate(
        repo_dir=repo,
        protocol=protocol,
        hypothesis="test mutate: slightly improve model if possible",
        trial_n=99,
        goal="lower val error",
        steer=[],
        instructions="Improve fare model MAE.",
    )
    print("mutate_result", json.dumps({k: out.get(k) for k in ("via","summary","files_touched","gateway_error","hypothesis") if k in out or out.get(k) is not None})[:1200])
    # restore
    if bak is not None:
        tp.write_text(bak, encoding="utf-8")
        subprocess.run(["git","checkout","--","train.py"], cwd=str(repo), check=False)
except Exception:
    traceback.print_exc()
PY`,
  }),
});
const j = await res.json();
console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 4000));
