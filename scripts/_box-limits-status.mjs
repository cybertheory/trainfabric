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
const headers = { Authorization: `Bearer ${vars.BOX_API_KEY}`, "User-Agent": "Mozilla/5.0" };

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const me = await get("/me");
const limits = await get("/limits");
const boxes = await get("/boxes");
const list = boxes.json.boxes || boxes.json.data || [];
const byState = {};
for (const b of list) {
  const s = b.state || "unknown";
  byState[s] = (byState[s] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      me: { status: me.status, body: me.json },
      limits: { status: limits.status, body: limits.json },
      boxCount: Array.isArray(list) ? list.length : null,
      byState,
      provisioning: list
        .filter((b) => /provision|clon/i.test(String(b.state)))
        .map((b) => ({ id: b.id, state: b.state, name: b.name, createdAt: b.createdAt })),
      archivedGoldens: list
        .filter((b) => /golden|autorunner/i.test(String(b.name || "")))
        .map((b) => ({
          id: b.id,
          state: b.state,
          name: b.name,
          snapshotAvailable: b.snapshotAvailable,
        })),
    },
    null,
    2,
  ),
);
