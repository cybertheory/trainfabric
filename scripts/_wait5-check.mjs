#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 30_000));
  const watch = existsSync("/tmp/tf-box-watch-fork.log")
    ? readFileSync("/tmp/tf-box-watch-fork.log", "utf8").trim().split("\n")
    : [];
  console.log(`t=${(i + 1) * 30}s last=`, watch.slice(-3).join(" | "));
  const joined = watch.join("\n");
  if (
    joined.includes("DONE_OK") ||
    joined.includes("TIMEOUT") ||
    joined.includes("BAD_STATE") ||
    joined.includes("READY")
  ) {
    console.log(watch.slice(-20).join("\n"));
    process.exit(joined.includes("DONE_OK") || joined.includes("READY") ? 0 : 1);
  }
}
console.log("poller done without terminal state");
if (existsSync("/tmp/tf-box-watch-fork.log")) {
  console.log(readFileSync("/tmp/tf-box-watch-fork.log", "utf8"));
}
process.exit(2);
