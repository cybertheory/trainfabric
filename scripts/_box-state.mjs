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
const id = process.argv[2] || "bx_g7ggrc3r";
const res = await fetch(`${base}/boxes/${id}`, {
  headers: { Authorization: `Bearer ${vars.BOX_API_KEY}` },
});
const json = await res.json();
console.log(
  JSON.stringify(
    {
      status: res.status,
      id: json.box?.id,
      state: json.box?.state,
      snapshotAvailable: json.box?.snapshotAvailable,
      name: json.box?.name,
    },
    null,
    2,
  ),
);
