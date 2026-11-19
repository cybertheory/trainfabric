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
const boxBase = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const runId = process.argv[2] || "auto_d83839ac48d5";
const token = await new SignJWT({
  email: "rishabhspro@gmail.com",
  scope: ["datasets:read", "trainfabric"],
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("user_3H1i74IdIFMqzzZ5VpXd6YFVKGh")
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

const detail = await fetch(`${base}/auto/${runId}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Mozilla/5.0" },
}).then((r) => r.json());
const run = detail.run || detail;
console.log(
  JSON.stringify(
    {
      ownerId: run.ownerId,
      status: run.status,
      box: run.box,
      progress: run.progress,
      trials: detail.trials,
      activity: (detail.activity || []).map((a) => ({ t: a.createdAt, m: a.message, k: a.kind })),
    },
    null,
    2,
  ),
);

const boxId = run.box?.boxId;
if (boxId) {
  const r = await fetch(`${boxBase}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      command:
        "tail -n 120 /tmp/autorunner.log; echo ===; ls -la ~/repo 2>&1 | head -15; echo ===; test -d ~/repo/.git && (cd ~/repo && git rev-parse --short HEAD && git status -sb | head -5) || echo no_repo",
    }),
  });
  const j = await r.json();
  console.log("\nBOX:\n", j.stdout || j.stderr || JSON.stringify(j).slice(0, 1500));
}
