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
const boxId = "bx_q3m6hdaj";
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const r = await fetch(`${base}/boxes/${boxId}/commands`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${vars.BOX_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
  },
  body: JSON.stringify({
    command:
      "wc -l /tmp/autorunner.log; echo ---; cat /tmp/autorunner.log; echo ---; ls -la ~/repo; echo ---; cd ~/repo && git log -3 --oneline; git status -sb; echo ---; env | grep -E '^CF_AI' | sed 's/=.*/=set/' ; echo ---; ps -eo pid,etime,cmd | grep trainfabric | grep -v grep",
  }),
});
console.log(await r.text());
