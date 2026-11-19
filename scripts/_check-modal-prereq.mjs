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
const subject = "user_3H1i74IdIFMqzzZ5VpXd6YFVKGh";
const token = await new SignJWT({
  email: "rishabhspro@gmail.com",
  scope: ["datasets:read", "trainfabric"],
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(subject)
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

const list = await fetch(`${base}/auto`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
}).then((r) => r.json().then((j) => ({ status: r.status, ...j })));

console.log(
  JSON.stringify(
    {
      apiStatus: list.status,
      prerequisites: list.prerequisites,
      runCount: (list.runs || []).length,
      sample: (list.runs || []).slice(0, 5).map((x) => ({
        id: x.id,
        status: x.status,
        provider: x.compute?.provider,
        progress: x.progress,
      })),
    },
    null,
    2,
  ),
);

const runId = process.argv[2] || list.runs?.[0]?.id;
if (runId) {
  const detail = await fetch(`${base}/auto/${runId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }).then((r) => r.json());
  const trials = detail.trials || [];
  console.log(
    JSON.stringify(
      {
        runId,
        status: detail.run?.status || detail.status,
        compute: detail.run?.compute || detail.compute,
        trials: trials.map((t) => ({
          id: t.id,
          status: t.status,
          externalId: t.externalId,
          score: t.score,
          error: t.error,
        })),
      },
      null,
      2,
    ),
  );
}
