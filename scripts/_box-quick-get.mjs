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
const id = process.argv[2] || "bx_4x53uk6q";
const ac = new AbortController();
const t = setTimeout(() => ac.abort(), 15_000);
try {
  const res = await fetch(`${base}/boxes/${id}`, {
    headers: { Authorization: `Bearer ${vars.BOX_API_KEY}`, "User-Agent": "Mozilla/5.0" },
    signal: ac.signal,
  });
  const j = await res.json();
  const b = j.box || j;
  console.log(JSON.stringify({ status: res.status, id: b.id, state: b.state, snap: b.snapshotAvailable }, null, 2));
} catch (e) {
  console.error("ERR", String(e));
  process.exit(1);
} finally {
  clearTimeout(t);
}
