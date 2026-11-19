#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(root, "services/router/.dev.vars"), "utf8").split("\n");
for (const l of lines) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i);
  if (/CF_AI|CF_ACCOUNT|GATEWAY/.test(k)) {
    const v = l.slice(i + 1).trim();
    console.log(`${k}=${v ? `set(${v.length})` : "empty"}`);
  }
}
