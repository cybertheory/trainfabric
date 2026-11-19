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
from gateway import chat_completions, AIGatewayError
tools = [{
  "type": "function",
  "function": {
    "name": "finish",
    "description": "Finish the trial",
    "parameters": {
      "type": "object",
      "properties": {
        "summary": {"type": "string"},
        "hypothesis": {"type": "string"}
      },
      "required": ["summary"]
    }
  }
}]
try:
    r = chat_completions(
        [
          {"role":"system","content":"You must call the finish tool. Do not reply with plain text."},
          {"role":"user","content":"Call finish with summary='tools work' and hypothesis='test'."},
        ],
        tools=tools,
        timeout=60.0,
    )
    choice = (r.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    print("finish_reason", choice.get("finish_reason"))
    print("content", repr((msg.get("content") or "")[:200]))
    print("tool_calls", json.dumps(msg.get("tool_calls"))[:800])
except AIGatewayError as e:
    print("AIGatewayError", str(e)[:2000])
except Exception as e:
    print(type(e).__name__, str(e)[:2000])
PY`,
  }),
});
const j = await res.json();
console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 3000));
