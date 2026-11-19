#!/usr/bin/env node
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
const OUT = "/tmp/tf-wait-single.log";
writeFileSync(OUT, "");
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 30_000));
  const t = existsSync("/tmp/tf-box-single-fork.log")
    ? readFileSync("/tmp/tf-box-single-fork.log", "utf8")
    : "";
  const lines = t.trim().split("\n");
  const msg = `t=${(i + 1) * 30}s last=${lines.slice(-3).join(" | ")}`;
  appendFileSync(OUT, msg + "\n");
  console.log(msg);
  if (t.includes("DONE_OK")) process.exit(0);
  if (t.includes("FATAL") || t.includes("TIMEOUT") || t.includes("BAD_STATE")) process.exit(1);
}
process.exit(2);
