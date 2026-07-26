/** Smoke POST /datasets/:id/prompt with agent token; print via flags from trace. */
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

const secret = vars.AGENT_TOKEN_SECRET;
const datasetId = process.argv[2] || "ds_9e4b1700db014717";
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
  .sign(new TextEncoder().encode(secret));

const base = "https://trainfabric-router.rishabhspro.workers.dev";
const res = await fetch(`${base}/datasets/${datasetId}/prompt`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "Show fare_amount for pickup_date 2024-01-01",
    execute: true,
    max_steps: 6,
  }),
});
const body = await res.json();
console.log("prompt_status", res.status);
console.log("agent", body.agent, "model", body.model);
console.log("columns", body.columns);
console.log("filter", body.filter);
const vias = [];
const blob = JSON.stringify(body);
const viaMatches = blob.match(/"via":"[^"]+"/g) || [];
console.log("via_mentions", viaMatches.join(" ") || "(none)");
for (const step of body.trace || []) {
  const via = step?.result?.via || step?.via;
  if (via) vias.push(`${step.tool || step.name || "?"}:${via}`);
  if (step?.tool) console.log("trace_step", step.tool, step.result?.via || "");
}
console.log("tool_vias", vias.join(", ") || "(none)");
if (body.error) console.log("error", body.error);
if (body.detail) console.log("detail", body.detail);
