/** One-off smoke: mint agent JWT with jose and hit prod whoami + datasets. */
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
if (!secret) throw new Error("AGENT_TOKEN_SECRET missing in .dev.vars");

const token = await new SignJWT({
  email: "smoke@trainfabric.test",
  dataset_id: "ds_smoke",
  scope: ["datasets:read"],
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("user_smoke_test")
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(new TextEncoder().encode(secret));

const base = "https://trainfabric-router.rishabhspro.workers.dev";
const who = await fetch(`${base}/auth/whoami`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log("whoami_status", who.status);
console.log("whoami_body", JSON.stringify(await who.json()));

const ds = await fetch(`${base}/datasets?limit=3`, {
  headers: { Authorization: `Bearer ${token}` },
});
const dsBody = await ds.json();
console.log("datasets_status", ds.status);
const list = Array.isArray(dsBody) ? dsBody : dsBody.datasets || dsBody.items || [];
console.log("datasets_count", Array.isArray(list) ? list.length : typeof dsBody);
if (Array.isArray(list) && list[0]?.id) console.log("sample_dataset", list[0].id);
