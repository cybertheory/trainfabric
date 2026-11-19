#!/usr/bin/env node
/** Resolve Clerk user id for an email and mint a session-like agent JWT. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";

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

const email = process.argv[2] || "rishabhspro@gmail.com";
const clerkKey = vars.CLERK_SECRET_KEY;
if (!clerkKey) throw new Error("CLERK_SECRET_KEY missing");

const q = new URL("https://api.clerk.com/v1/users");
q.searchParams.set("email_address", email);
q.searchParams.set("limit", "5");
const res = await fetch(q, { headers: { Authorization: `Bearer ${clerkKey}` } });
const users = await res.json();
if (!res.ok) {
  console.error(users);
  process.exit(1);
}
const list = Array.isArray(users) ? users : users.data || [];
const user = list[0];
if (!user?.id) {
  console.error("No Clerk user for", email, users);
  process.exit(1);
}
console.log(JSON.stringify({ id: user.id, email, username: user.username }, null, 2));

const token = await new SignJWT({
  email,
  scope: ["datasets:read", "trainfabric"],
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id)
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

writeFileSync(
  "/tmp/tf-rishabh-auth.json",
  JSON.stringify({ userId: user.id, email, token, base: vars.PUBLIC_API_BASE }, null, 2),
);
console.log("wrote /tmp/tf-rishabh-auth.json");
