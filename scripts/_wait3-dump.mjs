#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
await new Promise((r) => setTimeout(r, 180_000));
for (const f of ["/tmp/tf-box-watch-fork.log", "/tmp/tf-box-recover2.log"]) {
  console.log("\n====", f, "====");
  if (existsSync(f)) {
    const lines = readFileSync(f, "utf8").trim().split("\n");
    console.log(lines.slice(-30).join("\n"));
  } else console.log("missing");
}
