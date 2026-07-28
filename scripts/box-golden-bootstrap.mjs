#!/usr/bin/env node
/**
 * Build the Trainfabric autorunner golden Box template.
 *
 * Creates a noEnv box, installs the Hermes-parity autorunner stack (no secrets),
 * warms boot paths, stops it (snapshot = template), prints BOX_TEMPLATE_ID.
 *
 * Usage:
 *   BOX_API_KEY=… node scripts/box-golden-bootstrap.mjs
 *   # or load from services/router/.dev.vars
 *
 * Then:
 *   cd services/router && printf '%s' "$BOX_TEMPLATE_ID" | wrangler secret put BOX_TEMPLATE_ID
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BOX_API_BASE = (process.env.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(
  /\/$/,
  "",
);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTORUNNER = join(ROOT, "services/autorunner");
const NAME = "trainfabric-autorunner-golden";

function loadDevVars() {
  const path = join(ROOT, "services/router/.dev.vars");
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const vars = loadDevVars();
const apiKey = process.env.BOX_API_KEY || vars.BOX_API_KEY;
if (!apiKey) {
  console.error("BOX_API_KEY required (env or services/router/.dev.vars)");
  process.exit(1);
}

async function boxRequest(method, path, body) {
  const res = await fetch(`${BOX_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const msg = json.error?.message || json.message || `${method} ${path} → ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function waitReady(boxId, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const env = await boxRequest("GET", `/boxes/${boxId}`);
    const box = env.box ?? { id: boxId, state: env.status };
    const state = String(box.state ?? "");
    if (state === "ready" || state === "idle" || state === "running") return box;
    if (state === "error") throw new Error(`Box ${boxId} entered error`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Box ${boxId} not ready within timeout`);
}

async function command(boxId, command) {
  const env = await boxRequest("POST", `/boxes/${boxId}/commands`, { command });
  return { stdout: env.stdout || "", stderr: env.stderr || "" };
}

async function writeFile(boxId, path, content) {
  await boxRequest("PUT", `/boxes/${boxId}/files`, {
    path,
    content,
    encoding: "utf-8",
  });
}

function readLocal(rel) {
  return readFileSync(join(AUTORUNNER, rel), "utf8");
}

console.log("Creating golden Box (noEnv, no TTL)…");
const created = await boxRequest("POST", "/boxes", {
  ttlSeconds: null,
  noEnv: true,
});
const boxId = String(created.box?.id || created.id);
console.log("boxId", boxId);
await waitReady(boxId);

try {
  await boxRequest("PATCH", `/boxes/${boxId}`, { name: NAME });
} catch {
  console.warn("Could not rename box (PATCH name unsupported); continuing");
}

console.log("Installing stack…");
await command(boxId, "mkdir -p ~/trainfabric/inbox ~/trainfabric/skills");

const files = [
  ["~/trainfabric/autorunner_daemon.py", readLocal("autorunner_daemon.py")],
  ["~/trainfabric/gateway.py", readLocal("gateway.py")],
  ["~/trainfabric/agent_mutate.py", readLocal("agent_mutate.py")],
  ["~/trainfabric/chat_reply.py", readLocal("chat_reply.py")],
  ["~/trainfabric/chat_shim.py", readLocal("chat_shim.py")],
  [
    "~/trainfabric/skills/autoresearch-mutate.md",
    readLocal("skills/autoresearch-mutate/SKILL.md"),
  ],
  [
    "~/trainfabric/skills/publish-viz-github.md",
    readLocal("skills/publish-viz-github/SKILL.md"),
  ],
  ["~/trainfabric/skills/trainfabric-cli.md", readLocal("skills/trainfabric-cli/SKILL.md")],
];

for (const [path, content] of files) {
  // Box files API wants paths relative to the work directory (not ~/ or absolute).
  const rel = path.replace(/^~\//, "");
  try {
    await writeFile(boxId, rel, content);
    console.log("  wrote", path);
  } catch (e) {
    console.warn("  writeFile failed for", path, String(e.message), "— shell base64 fallback");
    const b64 = Buffer.from(content, "utf8").toString("base64");
    await command(
      boxId,
      `mkdir -p "$(dirname ${path})" && echo '${b64}' | base64 -d > ${path}`,
    );
  }
}

await command(
  boxId,
  "python3 -m pip install --user -q httpx matplotlib 2>/dev/null || pip3 install --user -q httpx matplotlib",
);

console.log("Warm boot (prefetch)…");
await command(
  boxId,
  'cd ~/trainfabric && python3 -c "import gateway; import agent_mutate; print(\'ok\')"',
);
await command(
  boxId,
  "python3 -m py_compile ~/trainfabric/autorunner_daemon.py ~/trainfabric/chat_shim.py ~/trainfabric/chat_reply.py ~/trainfabric/gateway.py",
);

console.log("Stopping box to snapshot template…");
await boxRequest("POST", `/boxes/${boxId}/stop`);

console.log(`
Golden template ready.

  BOX_TEMPLATE_ID=${boxId}

Set the Worker secret:

  cd services/router
  printf '%s' '${boxId}' | wrangler secret put BOX_TEMPLATE_ID

Or add to .dev.vars for local wrangler:

  BOX_TEMPLATE_ID=${boxId}

Every AutoRun will fork this box (noEnv) and inject campaign env + tfak_*.
`);
