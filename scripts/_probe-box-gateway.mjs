#!/usr/bin/env node
/**
 * Probe live AutoRun Box for AI Gateway env + httpx.
 * Usage: node scripts/_probe-box-gateway.mjs [auto_run_id]
 */
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

const apiBase = (vars.PUBLIC_API_BASE || "https://trainfabric-router.rishabhspro.workers.dev").replace(
  /\/$/,
  "",
);
const boxBase = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const runId = process.argv[2] || "auto_009f991fd32e";

const token = await new SignJWT({
  email: "rishabhspro@gmail.com",
  scope: ["datasets:read", "trainfabric"],
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("user_3H1i74IdIFMqzzZ5VpXd6YFVKGh")
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

const detail = await fetch(`${apiBase}/auto/${runId}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
}).then((r) => r.json());
const boxId = detail.run?.box?.boxId || detail.box?.boxId;
console.log({ runId, status: detail.run?.status, boxId });
if (!boxId) process.exit(1);

async function bcmd(command) {
  const res = await fetch(`${boxBase}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ command }),
  });
  return res.json();
}

const info = await fetch(`${boxBase}/boxes/${boxId}`, {
  headers: { Authorization: `Bearer ${vars.BOX_API_KEY}`, "User-Agent": "Mozilla/5.0" },
}).then((r) => r.json());
const state = info.box?.state || info.state || info.status;
console.log("boxState", state);

if (String(state).toLowerCase() === "archived") {
  console.log("resuming…");
  await fetch(`${boxBase}/boxes/${boxId}/resume`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ noEnv: true }),
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await fetch(`${boxBase}/boxes/${boxId}`, {
      headers: { Authorization: `Bearer ${vars.BOX_API_KEY}`, "User-Agent": "Mozilla/5.0" },
    }).then((r) => r.json());
    const st = s.box?.state || s.state;
    console.log("…", st);
    if (st === "ready" || st === "idle" || st === "running") break;
  }
}

const probe = await bcmd(`python3 - <<'PY'
import os, sys
sys.path.insert(0, os.path.expanduser("~/trainfabric"))
keys = ["CF_ACCOUNT_ID","CF_AI_GATEWAY_ID","CF_AI_GATEWAY_TOKEN","CF_AI_GATEWAY_BASE","CF_AI_MODEL","AUTORUN_ID","TF_TOKEN"]
for k in keys:
    v = os.environ.get(k, "")
    if "TOKEN" in k or k == "TF_TOKEN":
        print(f"{k}={'set('+str(len(v))+')' if v else 'MISSING'}")
    else:
        print(f"{k}={v[:80] if v else 'MISSING'}")
try:
    import httpx
    print("httpx", httpx.__version__)
except Exception as e:
    print("httpx MISSING", e)
try:
    from gateway import gateway_configured, gateway_config
    print("gateway_configured", gateway_configured())
    cfg = gateway_config()
    print("base_url", (cfg.get("base_url") or "")[:100])
    print("token_len", len(cfg.get("token") or ""))
except Exception as e:
    print("gateway import err", e)
PY`);
console.log(probe.stdout || probe.stderr || JSON.stringify(probe).slice(0, 1500));
