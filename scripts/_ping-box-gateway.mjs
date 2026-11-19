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
import os, sys, json
sys.path.insert(0, os.path.expanduser("~/trainfabric"))
from gateway import chat_completions, AIGatewayError, gateway_config
cfg = gateway_config()
print("url", cfg["base_url"] + "/chat/completions")
print("model", cfg["model"])
print("gateway_id", cfg["gateway_id"])
try:
    r = chat_completions(
        [{"role":"user","content":"Reply with exactly: ok"}],
        tools=None,
        timeout=45.0,
    )
    print("OK", json.dumps(r)[:500])
except AIGatewayError as e:
    print("AIGatewayError", str(e)[:1500])
except Exception as e:
    print(type(e).__name__, str(e)[:1500])
PY`,
  }),
});
const j = await res.json();
console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 2500));
