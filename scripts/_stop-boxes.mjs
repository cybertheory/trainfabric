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
for (const boxId of process.argv.slice(2)) {
  for (const action of ["interrupt", "stop"]) {
    const r = await fetch(`${base}/boxes/${boxId}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vars.BOX_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    console.log(boxId, action, r.status, (await r.text()).slice(0, 120));
  }
}
