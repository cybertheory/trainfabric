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
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const id = process.argv[2] || vars.BOX_TEMPLATE_ID || "bx_ckhpxtn3";

const res = await fetch(`${base}/boxes/${id}`, {
  headers: { Authorization: `Bearer ${vars.BOX_API_KEY}`, "User-Agent": "Mozilla/5.0" },
});
const json = await res.json().catch(() => ({}));
console.log(JSON.stringify({ status: res.status, box: json.box || json }, null, 2));

const fork = await fetch(`${base}/boxes/${id}/fork`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${vars.BOX_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
  },
  body: JSON.stringify({ noEnv: true }),
});
const fj = await fork.json().catch(() => ({}));
console.log(JSON.stringify({ forkStatus: fork.status, body: fj }, null, 2));
