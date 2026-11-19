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
const headers = {
  Authorization: `Bearer ${vars.BOX_API_KEY}`,
  "User-Agent": "Mozilla/5.0",
};
const id = process.argv[2] || "bx_r7xhm38r";
for (const action of ["stop", "interrupt"]) {
  try {
    const r = await fetch(`${base}/boxes/${id}/${action}`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    console.log(action, r.status, (await r.text()).slice(0, 100));
  } catch (e) {
    console.log(action, String(e));
  }
}
try {
  const r = await fetch(`${base}/boxes/${id}`, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  console.log("DELETE", r.status, (await r.text()).slice(0, 150));
} catch (e) {
  console.log("DELETE", String(e));
}
const tmpl = await fetch(`${base}/boxes/bx_ckhpxtn3`, {
  headers,
  signal: AbortSignal.timeout(20_000),
});
const j = await tmpl.json();
const b = j.box || j;
console.log(
  JSON.stringify(
    {
      template: {
        id: b.id,
        state: b.state,
        snap: b.snapshotAvailable,
        lastSnapshotStatus: b.lastSnapshotStatus,
      },
      BOX_TEMPLATE_ID: vars.BOX_TEMPLATE_ID,
    },
    null,
    2,
  ),
);
