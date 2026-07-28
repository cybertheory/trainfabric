#!/usr/bin/env node
/**
 * Build the Trainfabric autorunner golden Box template.
 *
 * Creates a noEnv box, installs Hermes (same package as compute) + `tf` CLI +
 * autorunner daemon stack (no secrets), warms boot paths, stops it
 * (snapshot = template), prints BOX_TEMPLATE_ID.
 *
 * Usage:
 *   BOX_API_KEY=… node scripts/box-golden-bootstrap.mjs
 *   # or load from services/router/.dev.vars
 *
 * Then:
 *   cd services/router && printf '%s' "$BOX_TEMPLATE_ID" | wrangler secret put BOX_TEMPLATE_ID
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const BOX_API_BASE = (process.env.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(
  /\/$/,
  "",
);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTORUNNER = join(ROOT, "services/autorunner");
const COMPUTE_APP = join(ROOT, "services/compute/app");
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

function walkFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full, base));
    else if (st.isFile()) out.push({ abs: full, rel: relative(base, full).replaceAll("\\", "/") });
  }
  return out;
}

async function writeBoxPath(boxId, path, content) {
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

console.log("Installing Hermes + tf CLI + autorunner stack…");
await command(
  boxId,
  "mkdir -p ~/trainfabric/inbox ~/trainfabric/skills ~/trainfabric/app/hermes/skills ~/trainfabric/bin ~/.local/bin",
);

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
  // Lightweight app package so `import app.hermes` / `python -m app.tf_cli` work.
  ["~/trainfabric/app/__init__.py", "# Box golden — Hermes + tf only\n"],
];

for (const [path, content] of files) {
  await writeBoxPath(boxId, path, content);
}

// Same Hermes agent + tf CLI as the compute/query container.
for (const pkg of ["hermes", "tf_cli"]) {
  const root = join(COMPUTE_APP, pkg);
  for (const f of walkFiles(root)) {
    const content = readFileSync(f.abs, "utf8");
    await writeBoxPath(boxId, `~/trainfabric/app/${pkg}/${f.rel}`, content);
  }
}

const tfWrapper = `#!/bin/sh
export PYTHONPATH="$HOME/trainfabric\${PYTHONPATH:+:\$PYTHONPATH}"
export HERMES_SKILLS_DIR="\${HERMES_SKILLS_DIR:-$HOME/trainfabric/app/hermes/skills}"
# Box campaign env aliases
if [ -n "\$TF_API_URL" ] && [ -z "\$TRAINFABRIC_API_URL" ]; then export TRAINFABRIC_API_URL="\$TF_API_URL"; fi
if [ -n "\$TF_TOKEN" ] && [ -z "\$TRAINFABRIC_TOKEN" ]; then export TRAINFABRIC_TOKEN="\$TF_TOKEN"; fi
if [ -n "\$TF_DATASET_ID" ] && [ -z "\$TRAINFABRIC_DATASET_ID" ]; then export TRAINFABRIC_DATASET_ID="\$TF_DATASET_ID"; fi
exec python3 -m app.tf_cli "\$@"
`;
await writeBoxPath(boxId, "~/trainfabric/bin/tf", tfWrapper);
await command(
  boxId,
  "chmod +x ~/trainfabric/bin/tf && ln -sfn ~/trainfabric/bin/tf ~/.local/bin/tf && ln -sfn ~/trainfabric/bin/tf /usr/local/bin/tf 2>/dev/null || true",
);

await command(
  boxId,
  "python3 -m pip install --user -q httpx matplotlib typer 2>/dev/null || pip3 install --user -q httpx matplotlib typer",
);

console.log("Warm boot (Hermes + tf)…");
await command(
  boxId,
  'export PYTHONPATH="$HOME/trainfabric${PYTHONPATH:+:$PYTHONPATH}" PATH="$HOME/trainfabric/bin:$HOME/.local/bin:$PATH" && cd ~/trainfabric && python3 -c "from app.hermes import run_hermes_prompt; from app.hermes.gateway import gateway_configured; import agent_mutate; print(\'hermes_ok\', gateway_configured())"',
);
await command(
  boxId,
  'export PATH="$HOME/trainfabric/bin:$HOME/.local/bin:$PATH" PYTHONPATH="$HOME/trainfabric${PYTHONPATH:+:$PYTHONPATH}" && tf --help >/dev/null && python3 -m py_compile ~/trainfabric/autorunner_daemon.py ~/trainfabric/chat_shim.py ~/trainfabric/chat_reply.py ~/trainfabric/app/hermes/agent.py ~/trainfabric/app/tf_cli/__init__.py',
);

console.log("Stopping box to snapshot template…");
await boxRequest("POST", `/boxes/${boxId}/stop`);

console.log(`
Golden template ready (Hermes + tf CLI).

  BOX_TEMPLATE_ID=${boxId}

Set the Worker secret:

  cd services/router
  printf '%s' '${boxId}' | wrangler secret put BOX_TEMPLATE_ID

Or add to .dev.vars for local wrangler:

  BOX_TEMPLATE_ID=${boxId}

Every AutoRun will fork this box (noEnv) and inject campaign env + tfak_*.
Daemon uses \`tf\` (not raw urllib) so Box stays on the same platform surface as MCP.
`);
