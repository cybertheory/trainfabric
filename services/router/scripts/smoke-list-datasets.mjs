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
const token = await new SignJWT({ email: "smoke@trainfabric.test", scope: ["datasets:read"] })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("user_smoke_test")
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

const q = process.argv[2] || "taxi";
const base = "https://trainfabric-router.rishabhspro.workers.dev";
const ds = await (
  await fetch(`${base}/datasets?search=${encodeURIComponent(q)}&limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
const list = Array.isArray(ds) ? ds : ds.datasets || [];
console.log(JSON.stringify(list.map((d) => ({ id: d.id, name: d.name || d.title })), null, 2));
