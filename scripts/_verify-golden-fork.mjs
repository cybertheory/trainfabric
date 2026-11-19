#!/usr/bin/env node
/** Fork golden template and verify httpx + tf CLI. */
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

const templateId = process.argv[2] || vars.BOX_TEMPLATE_ID || "bx_ckhpxtn3";
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const key = vars.BOX_API_KEY;
if (!key) {
  console.error("BOX_API_KEY missing");
  process.exit(1);
}

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

const forked = await req("POST", `/boxes/${templateId}/fork`, { noEnv: true });
const id = String(forked.box?.id || forked.id);
console.log("forked", id);

for (let i = 0; i < 90; i++) {
  const env = await req("GET", `/boxes/${id}`);
  const st = String(env.box?.state || env.status || "");
  if (st === "ready" || st === "idle" || st === "running") break;
  if (st === "error") throw new Error(`box entered error: ${st}`);
  await new Promise((r) => setTimeout(r, 2000));
}

const check = await req("POST", `/boxes/${id}/commands`, {
  command: [
    "~/trainfabric/.venv/bin/python -c \"import httpx,typer; print('ok', httpx.__version__)\"",
    "export PATH=\"$HOME/trainfabric/bin:$HOME/trainfabric/.venv/bin:$PATH\" PYTHONPATH=\"$HOME/trainfabric\"",
    "tf --help | head -5",
  ].join(" && "),
});
console.log("stdout:", (check.stdout || "").trim());
if (check.stderr) console.log("stderr:", String(check.stderr).slice(0, 500));

const out = `${check.stdout || ""}\n${check.stderr || ""}`;
if (!out.includes("ok ") || !/Usage:|tf |Commands/i.test(out)) {
  await req("POST", `/boxes/${id}/stop`).catch(() => {});
  console.error("VERIFY FAILED");
  process.exit(1);
}

await req("POST", `/boxes/${id}/stop`).catch(() => {});
console.log("VERIFY OK", id);
