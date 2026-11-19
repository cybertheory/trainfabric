#!/usr/bin/env node
/** Upload tiny parquet-ish bytes to R2 and enqueue Modal trial via Clerk JWT. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "services/router/package.json"));
// use AWS SDK from compute if available — else curl S3 API is hard; use wrangler r2
const auth = JSON.parse(readFileSync("/tmp/tf-clerk-session.json", "utf8"));
// refresh jwt if needed
const base = String(auth.base).replace(/\/$/, "");
const autoRunId = process.argv[2] || "auto_f790472dca81";
const key = `results/e2e-smoke-${Date.now()}.bin`;
const local = `/tmp/e2e-slice.bin`;
writeFileSync(local, Buffer.from("trainfabric-e2e-slice-bytes-0123456789"));

execSync(
  `cd ${join(root, "services/router")} && npx wrangler r2 object put trainfabric-data/${key} --file=${local} --remote`,
  { stdio: "inherit" },
);

const url = `${base}/r2/${key}`;
const dataSpec = {
  uri: `s3://trainfabric-data/${key}`,
  format: "bin",
  size_bytes: 40,
};
const repo = "/tmp/tf-e2e-handoff-repo2";
execSync(`rm -rf ${repo} && git clone --depth 1 https://github.com/cybertheory/trainfabric-e2e-smoke ${repo}`, {
  stdio: "inherit",
});
mkdirSync(`${repo}/artifacts`, { recursive: true });
writeFileSync(`${repo}/artifacts/data_spec.json`, JSON.stringify(dataSpec, null, 2) + "\n");
writeFileSync(`${repo}/artifacts/data_url.txt`, url + "\n");
execSync(
  `cd ${repo} && git add artifacts && git -c user.email=e2e@trainfabric.dev -c user.name=e2e commit -m "e2e r2 handoff" && git push`,
  { stdio: "inherit" },
);
const sha = execSync(`cd ${repo} && git rev-parse HEAD`).toString().trim();
console.log(JSON.stringify({ key, url, sha, dataSpec }));

const trial = await fetch(`${base}/auto/${autoRunId}/trials`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${auth.jwt}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "trainfabric-e2e/1.0",
  },
  body: JSON.stringify({
    hypothesis: "e2e modal mount via wrangler r2 object",
    commitSha: sha,
    dataSpec,
    estimatedBytes: 40,
  }),
});
const body = await trial.json();
console.log(JSON.stringify({ trialHttp: trial.status, body }, null, 2));
writeFileSync("/tmp/tf-e2e-trial.json", JSON.stringify({ key, url, sha, dataSpec, body }, null, 2));
