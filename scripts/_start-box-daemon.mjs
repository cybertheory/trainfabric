#!/usr/bin/env node
/** Start autorunner_daemon detached on a Box. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vars = Object.fromEntries(
  readFileSync(join(root, "services/router/.dev.vars"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const boxId = process.argv[2];
if (!boxId) throw new Error("usage: start-box-daemon.mjs <boxId>");
const baseBox = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");

async function box(method, path, body) {
  const res = await fetch(`${baseBox}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 500)}`);
  return json;
}

async function cmd(command) {
  console.log("\n$", command.slice(0, 160));
  const r = await box("POST", `/boxes/${boxId}/commands`, { command });
  console.log((r.stdout || "") + (r.stderr ? "\nSTDERR: " + r.stderr : "") || JSON.stringify(r).slice(0, 600));
  return r;
}

const info = await box("GET", `/boxes/${boxId}`);
console.log("box", { id: boxId, state: (info.box || info).state || (info.box || info).status });

await cmd(
  "python3 -c \"import os,subprocess,sys; subprocess.Popen(['python3','/home/user/trainfabric/autorunner_daemon.py'], stdout=open('/tmp/autorunner.log','a'), stderr=subprocess.STDOUT, start_new_session=True); print('spawned')\"",
);
await cmd("sleep 2; ps aux | grep autorunner_daemon | grep -v grep; echo ---; head -100 /tmp/autorunner.log; echo ---; (ss -ltn 2>/dev/null || netstat -ltn) | grep 8787 || echo no_listen");
const hosted = await cmd("host 8787 --private 2>&1 || true");
const m = String(hosted.stdout || "").match(/https:\/\/\S+/);
console.log("\ndaemonHostUrl:", m?.[0] || "(none)");
