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
import os, sys, json, subprocess
from pathlib import Path
sys.path.insert(0, os.path.expanduser("~/trainfabric"))
import importlib, gateway, agent_mutate
importlib.reload(gateway); importlib.reload(agent_mutate)
repo = Path(os.path.expanduser("~/repo"))
tp = repo/"train.py"
bak = tp.read_text(encoding="utf-8")
protocol = {"metric":{"name":"val_bpb","direction":"min"},"budget":{"maxTrials":20,"maxWallClockSec":3600},"mutablePaths":["train.py"],"immutablePaths":["prepare.py","protocol.yaml"]}
try:
    out = agent_mutate.propose_mutate(repo_dir=repo, protocol=protocol, hypothesis="Reduce overfitting: smaller model or stronger regularization", trial_n=102, goal="lower val_bpb", steer=[], instructions="Improve NYC taxi fare model.")
    print("RESULT", json.dumps({"via": out.get("via"), "summary": (out.get("summary") or "")[:250], "files_touched": out.get("files_touched"), "err": (str(out.get("gateway_error"))[:200] if out.get("gateway_error") else None)}))
    if "train.py" in (out.get("files_touched") or []):
        # show whether content changed vs bak
        now = tp.read_text(encoding="utf-8")
        print("CHANGED", now != bak, "len_delta", len(now)-len(bak))
        # print first non-comment added lines
        for line in now.splitlines():
            if "autorunner touch" in line: continue
        print("HEAD", "\\n".join(now.splitlines()[:25]))
finally:
    tp.write_text(bak, encoding="utf-8")
    subprocess.run(["git","checkout","--","train.py"], cwd=str(repo), check=False)
PY`,
  }),
});
const j = await res.json();
console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 3500));
