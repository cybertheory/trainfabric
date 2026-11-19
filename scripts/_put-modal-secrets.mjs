#!/usr/bin/env node
/** Push MODAL_APP_REF + MODAL_TOKEN from ~/.modal.toml into Worker secrets. */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const router = join(root, "services/router");
const toml = readFileSync(join(homedir(), ".modal.toml"), "utf8");
const id = (toml.match(/token_id\s*=\s*"([^"]+)"/) || [])[1];
const secret = (toml.match(/token_secret\s*=\s*"([^"]+)"/) || [])[1];
if (!id || !secret) {
  console.error("missing modal token in ~/.modal.toml");
  process.exit(1);
}
const appRef =
  process.env.MODAL_APP_REF ||
  "https://rishabhspro--trainfabric-trial-run-trial.modal.run";
const token = `${id}:${secret}`;

function put(name, value) {
  const r = spawnSync(
    "npx",
    ["wrangler", "secret", "put", name],
    {
      cwd: router,
      input: value,
      encoding: "utf8",
      env: process.env,
    },
  );
  console.log(name, r.status === 0 ? "ok" : "fail", (r.stderr || r.stdout || "").slice(-200));
  if (r.status !== 0) process.exit(r.status || 1);
}

put("MODAL_APP_REF", appRef);
put("MODAL_TOKEN", token);
console.log(JSON.stringify({ appRef, tokenLen: token.length }));
