#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
const files = ["/tmp/tf-box-resume-smoke.log", "/tmp/tf-box-watch-fork.log"];
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 30_000));
  console.log(`\n=== t=${(i + 1) * 30}s ${new Date().toISOString()} ===`);
  for (const f of files) {
    if (!existsSync(f)) continue;
    const lines = readFileSync(f, "utf8").trim().split("\n");
    console.log(f, "->", lines.slice(-4).join(" || "));
    const t = lines.join("\n");
    if (t.includes("DONE_RESUME_OK") || t.includes("DONE_OK")) {
      console.log("SUCCESS");
      process.exit(0);
    }
    if (t.includes("RESUME_TIMEOUT") || t.includes("TIMEOUT\n") || t.includes("BAD_STATE")) {
      console.log("FAIL terminal");
      process.exit(1);
    }
  }
}
process.exit(2);
