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
const jobId = process.argv[2] || "job_1786a8f3e33d";
const datasetId = process.argv[3] || "ds_b5e6abdbabf04bf4";

const tok = await new SignJWT({
  email: "rishabhspro@gmail.com",
  scope: ["datasets:read", "trainfabric"],
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("user_3H1i74IdIFMqzzZ5VpXd6YFVKGh")
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

for (let i = 0; i < 36; i++) {
  const r = await fetch(`${base}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
  });
  const j = await r.json();
  const status = j.status || j.job?.status;
  console.log(JSON.stringify({ i, http: r.status, status, error: j.error || j.job?.error }));
  if (["done", "succeeded", "completed", "failed", "error"].includes(String(status || "").toLowerCase())) {
    const s = await fetch(`${base}/datasets/${datasetId}/schema`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
    });
    console.log("schema", s.status, JSON.stringify(await s.json()).slice(0, 800));
    break;
  }
  await new Promise((r) => setTimeout(r, 10000));
}
