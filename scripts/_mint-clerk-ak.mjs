#!/usr/bin/env node
/** Create a short-lived Clerk API key for write tests. Prints only key prefix. */
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

const userId = process.argv[2] || "user_3H1i74IdIFMqzzZ5VpXd6YFVKGh";
const res = await fetch("https://api.clerk.com/v1/api_keys", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${vars.CLERK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    type: "api_key",
    subject: userId,
    name: "e2e-stress",
    description: "temporary e2e write key",
    scopes: ["*"],
  }),
});
const json = await res.json();
if (!res.ok) {
  console.error(JSON.stringify(json).slice(0, 500));
  process.exit(1);
}
const secret = json.secret || json.api_key || json.key;
writeFileSync(
  "/tmp/tf-clerk-ak.json",
  JSON.stringify(
    {
      id: json.id,
      secret,
      userId,
      base: vars.PUBLIC_API_BASE,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(JSON.stringify({ ok: true, id: json.id, secretPrefix: String(secret || "").slice(0, 8) }));
