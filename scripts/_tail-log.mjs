#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
const p = process.argv[2] || "/tmp/tf-e2e-big.log";
if (!existsSync(p)) {
  console.log("missing", p);
  process.exit(1);
}
const t = readFileSync(p, "utf8");
console.log("bytes", t.length, "lines", t.split("\n").length);
console.log(t.slice(-4000));
