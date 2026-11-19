#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { SignJWT } = createRequire(join(root, "services/router/package.json"))("jose");
const vars = Object.fromEntries(
  readFileSync(join(root, "services/router/.dev.vars"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const base = (vars.PUBLIC_API_BASE || "https://trainfabric-router.rishabhspro.workers.dev").replace(
  /\/$/,
  "",
);
const token = await new SignJWT({ email: "rishabhspro@gmail.com", scope: ["trainfabric"] })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("user_3H1i74IdIFMqzzZ5VpXd6YFVKGh")
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

const detail = await fetch(`${base}/auto/auto_d83839ac48d5`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Mozilla/5.0" },
}).then((r) => r.json());
console.log(
  JSON.stringify(
    {
      status: detail.run?.status,
      progress: detail.run?.progress,
      box: detail.run?.box,
      compute: detail.run?.compute,
      trials: detail.trials,
      activity: (detail.activity || []).map((a) => ({ m: a.message, meta: a.meta })),
    },
    null,
    2,
  ),
);
const msgs = await fetch(`${base}/auto/auto_d83839ac48d5/messages?limit=30`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Mozilla/5.0" },
}).then((r) => r.json());
console.log(
  "messages",
  JSON.stringify(
    (msgs.messages || []).map((m) => ({ role: m.role, src: m.source, c: String(m.content).slice(0, 160) })),
    null,
    2,
  ),
);
