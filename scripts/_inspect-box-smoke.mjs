#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "services/router/package.json"));
const { SignJWT } = require("jose");

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
const boxId = process.argv[3] || "bx_92vqgdad";
const baseBox = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const apiBase = (vars.PUBLIC_API_BASE || "https://trainfabric-router.rishabhspro.workers.dev").replace(
  /\/$/,
  "",
);

async function box(method, path, body) {
  const res = await fetch(`${baseBox}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 400)}`);
  return json;
}

console.log("=== Clerk user ===");
const q = new URL("https://api.clerk.com/v1/users");
q.searchParams.set("email_address", email);
q.searchParams.set("limit", "3");
const cu = await fetch(q, { headers: { Authorization: `Bearer ${vars.CLERK_SECRET_KEY}` } });
const users = await cu.json();
const user = (Array.isArray(users) ? users : users.data || [])[0];
console.log(user ? { id: user.id, email } : users);

console.log("\n=== Box status ===");
const info = await box("GET", `/boxes/${boxId}`);
const b = info.box || info;
console.log({ id: b.id, state: b.state || b.status, name: b.name });

console.log("\n=== ls trainfabric ===");
try {
  const ls = await box("POST", `/boxes/${boxId}/commands`, {
    command: "ls -la ~/trainfabric 2>&1; echo ---; ps aux | grep -E 'autorunner|chat_shim' | grep -v grep || true; echo ---; tail -n 40 /tmp/autorunner.log 2>/dev/null || echo no_autorunner_log; echo ---; tail -n 20 /tmp/tf-chat.log 2>/dev/null || echo no_chat_log; echo ---; env | grep -E '^(AUTORUN|TF_|CF_|REPO_|GITHUB_|PROTOCOL)' | sed 's/=.*/=***/' || true",
  });
  console.log(ls.stdout || ls.stderr || JSON.stringify(ls).slice(0, 2000));
} catch (e) {
  console.error("command failed", e.message);
}

if (String(b.state || b.status).toLowerCase() === "archived") {
  console.log("\n=== resume box ===");
  await box("POST", `/boxes/${boxId}/resume`, { noEnv: true });
}

console.log("\n=== start daemon ===");
const start = await box("POST", `/boxes/${boxId}/commands`, {
  command:
    "mkdir -p ~/trainfabric/inbox ~/trainfabric/skills && pkill -f 'chat_shim.py' 2>/dev/null || true; pkill -f 'autorunner_daemon.py' 2>/dev/null || true; nohup python3 ~/trainfabric/chat_shim.py >/tmp/tf-chat.log 2>&1 & nohup python3 ~/trainfabric/autorunner_daemon.py >/tmp/autorunner.log 2>&1 & sleep 2; ps aux | grep -E 'autorunner|chat_shim' | grep -v grep; host 8787 --private 2>&1 | tail -5",
});
console.log(start.stdout || start.stderr || JSON.stringify(start).slice(0, 1500));

if (user?.id) {
  const token = await new SignJWT({ email, scope: ["datasets:read", "trainfabric"] })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("trainfabric-agent")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));
  const who = await fetch(`${apiBase}/auth/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("\n=== whoami as clerk user ===", who.status, await who.text());
}
