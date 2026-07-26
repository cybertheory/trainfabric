import { readFileSync } from "node:fs";
import { SignJWT } from "jose";

const vars = Object.fromEntries(
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const datasetId = process.argv[2] || "ds_a135d312f86c4b23";
const token = await new SignJWT({
  email: "smoke@trainfabric.test",
  dataset_id: datasetId,
  scope: ["datasets:read"],
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("user_smoke_test")
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

const base = "https://trainfabric-router.rishabhspro.workers.dev";
const res = await fetch(`${base}/datasets/${datasetId}/schema`, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await res.json();
console.log("schema_status", res.status);
console.log(
  "columns",
  (body.columns || []).slice(0, 8).map((c) => c.name || c),
);
