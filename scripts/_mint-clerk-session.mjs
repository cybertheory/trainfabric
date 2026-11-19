#!/usr/bin/env node
/** Mint a Clerk session JWT for write API calls (dev/test). */
import { readFileSync, writeFileSync } from "node:fs";
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
const sk = vars.CLERK_SECRET_KEY;
const email = process.argv[2] || "rishabhspro@gmail.com";

const uq = new URL("https://api.clerk.com/v1/users");
uq.searchParams.set("email_address", email);
uq.searchParams.set("limit", "3");
const users = await fetch(uq, { headers: { Authorization: `Bearer ${sk}` } }).then((r) => r.json());
const user = (Array.isArray(users) ? users : users.data || [])[0];
if (!user?.id) {
  console.error(users);
  process.exit(1);
}

// Prefer an existing session
const sessList = await fetch(`https://api.clerk.com/v1/sessions?user_id=${user.id}&status=active&limit=5`, {
  headers: { Authorization: `Bearer ${sk}` },
}).then((r) => r.json());
let sessionId = (Array.isArray(sessList) ? sessList : sessList.data || [])[0]?.id;

if (!sessionId) {
  const created = await fetch("https://api.clerk.com/v1/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: user.id }),
  }).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json() }));
  console.log("create_session", created.status, created.json?.id || created.json?.errors?.[0]?.code);
  sessionId = created.json?.id;
}

if (!sessionId) {
  console.error("no session");
  process.exit(1);
}

const tok = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens`, {
  method: "POST",
  headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" },
  body: JSON.stringify({}),
}).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json() }));

const jwt = tok.json?.jwt || tok.json?.token;
if (!jwt) {
  console.error(tok);
  process.exit(1);
}
writeFileSync(
  "/tmp/tf-clerk-session.json",
  JSON.stringify(
    {
      userId: user.id,
      sessionId,
      jwt,
      base: vars.PUBLIC_API_BASE || "https://trainfabric-router.rishabhspro.workers.dev",
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(JSON.stringify({ ok: true, userId: user.id, sessionId, jwtPrefix: jwt.slice(0, 20) }));
