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
const boxId = process.argv[2] || "bx_q3m6hdaj";
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const h = {
  Authorization: `Bearer ${vars.BOX_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0",
};

console.log("interrupt…");
let r = await fetch(`${base}/boxes/${boxId}/interrupt`, { method: "POST", headers: h });
console.log("interrupt", r.status, await r.text());

await new Promise((x) => setTimeout(x, 2000));

r = await fetch(`${base}/boxes/${boxId}/commands`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({
    command:
      "grep -n User-Agent ~/trainfabric/autorunner_daemon.py | head -3; echo ---; wc -l /tmp/autorunner.log; tail -n 80 /tmp/autorunner.log",
  }),
});
console.log(await r.text());
