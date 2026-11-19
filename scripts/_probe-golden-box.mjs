#!/usr/bin/env node
/** Probe AutoRun Box for httpx + tf + daemon health. */
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

const boxId = process.argv[2] || "bx_5grk9g39";
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(`${method} ${path} ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

const cmd = await req("POST", `/boxes/${boxId}/commands`, {
  command: [
    "echo ===deps===",
    "~/trainfabric/.venv/bin/python -c \"import httpx,typer; print('venv', httpx.__version__)\" 2>&1",
    "export PATH=\"$HOME/trainfabric/bin:$HOME/trainfabric/.venv/bin:$PATH\" PYTHONPATH=\"$HOME/trainfabric\"",
    "which tf; tf --help 2>&1 | head -4",
    "echo ===ua===",
    "grep -n User-Agent ~/trainfabric/app/tf_cli/__init__.py | head -2",
    "echo ===daemon===",
    "pgrep -af 'autorunner_daemon|chat_shim' || true",
    "tail -n 30 /tmp/autorunner.log 2>/dev/null || true",
    "tail -n 20 /tmp/tf-chat.log 2>/dev/null || true",
  ].join("; "),
});
console.log(cmd.stdout || "");
if (cmd.stderr) console.error("STDERR", cmd.stderr);
