#!/usr/bin/env node
/**
 * Hotpatch agent_mutate.py onto a live Box and dry-run propose_mutate.
 * Usage: node scripts/_hotpatch-mutate.mjs [boxId]
 */
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

console.log("writing agent_mutate.py…");
const write = await bcmd(
  `python3 -c "import base64,pathlib; p=pathlib.Path.home()/ 'trainfabric'/'agent_mutate.py'; p.write_bytes(base64.b64decode('${b64}')); print('wrote', p, 'bytes', p.stat().st_size)"`,
);
console.log(write.stdout || write.stderr || JSON.stringify(write).slice(0, 500));

console.log("dry-run mutate…");
const dry = await bcmd(`python3 - <<'PY'
import os, sys, json, subprocess, traceback
from pathlib import Path
sys.path.insert(0, os.path.expanduser("~/trainfabric"))
# force reload
import importlib
import agent_mutate
importlib.reload(agent_mutate)
repo = Path(os.path.expanduser("~/repo"))
tp = repo/"train.py"
bak = tp.read_text(encoding="utf-8")
protocol = {
  "metric": {"name":"val_bpb","direction":"min"},
  "budget": {"maxTrials":20,"maxWallClockSec":3600},
  "mutablePaths":["train.py"],
  "immutablePaths":["prepare.py","protocol.yaml"],
}
try:
    out = agent_mutate.propose_mutate(
        repo_dir=repo,
        protocol=protocol,
        hypothesis="Slightly regularize or simplify the fare model to lower val error",
        trial_n=100,
        goal="lower val_bpb",
        steer=[],
        instructions="Improve NYC taxi fare model MAE on held-out day.",
    )
    print(json.dumps({k: out.get(k) for k in ("via","summary","files_touched","gateway_error")}))
finally:
    tp.write_text(bak, encoding="utf-8")
    subprocess.run(["git","checkout","--","train.py"], cwd=str(repo), check=False)
PY`);
console.log(dry.stdout || dry.stderr || JSON.stringify(dry).slice(0, 3000));
