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
const r = await fetch(`${base}/boxes/${boxId}/commands`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${vars.BOX_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
  },
  body: JSON.stringify({
    command: `python3 - <<'PY'
import os, traceback
print('httpx', end=' ')
try:
 import httpx; print(httpx.__version__)
except Exception as e:
 print('MISSING', e)
print('agent_mutate', end=' ')
import sys
sys.path.insert(0, os.path.expanduser('~/trainfabric'))
try:
 import agent_mutate, gateway
 print('ok', hasattr(agent_mutate,'propose_mutate'))
except Exception:
 traceback.print_exc()
print('CF_ACCOUNT', 'set' if os.environ.get('CF_ACCOUNT_ID') else 'missing')
print('gateway base', os.environ.get('CF_AI_GATEWAY_BASE','')[:60])
# quick gateway ping with short timeout
try:
 from gateway import chat_completion
 r = chat_completion(messages=[{"role":"user","content":"reply with ok"}], tools=None, timeout=30)
 print('gateway', type(r), str(r)[:200])
except Exception as e:
 print('gateway_err', type(e).__name__, e)
PY`,
  }),
});
const j = await r.json();
console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 2000));
