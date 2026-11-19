#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
const log = "/tmp/tf-box-recover2.log";
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 15_000));
  if (!existsSync(log)) {
    console.log("no log yet");
    continue;
  }
  const text = readFileSync(log, "utf8");
  const lines = text.trim().split("\n");
  console.log(`\n--- poll ${i} lines=${lines.length} ---`);
  console.log(lines.slice(-15).join("\n"));
  if (text.includes("DONE") || text.includes("FATAL") || text.includes("Error: timeout waiting")) {
    process.exit(text.includes("DONE") ? 0 : 1);
  }
}
process.exit(2);
