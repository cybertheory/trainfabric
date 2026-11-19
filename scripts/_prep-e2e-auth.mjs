#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(script) {
  const r = spawnSync(process.execPath, [join(root, "scripts", script)], {
    encoding: "utf8",
    cwd: root,
  });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  if (r.status !== 0) process.exit(r.status || 1);
}

run("_mint-clerk-session.mjs");
run("_mint-clerk-ak.mjs");

const a = JSON.parse(readFileSync("/tmp/tf-clerk-session.json", "utf8"));
const k = JSON.parse(readFileSync("/tmp/tf-clerk-ak.json", "utf8"));
const base = String(a.base || k.base).replace(/\/$/, "");

for (const [name, tok] of [
  ["jwt", a.jwt],
  ["ak", k.secret],
]) {
  const r = await fetch(`${base}/auth/whoami`, {
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });
  const j = await r.json().catch(() => ({}));
  console.log(name, r.status, j.authVia || j.error || j.subject);
}

writeFileSync(
  "/tmp/tf-e2e-auth-ok.json",
  JSON.stringify({ ok: true, base, at: new Date().toISOString() }, null, 2),
);
