#!/usr/bin/env node
/** Patch autorunner on a live Box and restart; probe Cloudflare UA. */
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
const boxId = process.argv[2] || "bx_q3m6hdaj";
const baseBox = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const daemonSrc = readFileSync(join(root, "services/autorunner/autorunner_daemon.py"), "utf8");

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
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 400)}`);
  return json;
}

async function cmd(command) {
  console.log("\n$", command.slice(0, 140));
  const r = await box("POST", `/boxes/${boxId}/commands`, { command });
  console.log((r.stdout || "") + (r.stderr ? "\nSTDERR " + r.stderr : "") || JSON.stringify(r).slice(0, 500));
  return r;
}

console.log("writing autorunner_daemon.py…", daemonSrc.length, "bytes");
await box("PUT", `/boxes/${boxId}/files`, {
  path: "trainfabric/autorunner_daemon.py",
  content: daemonSrc,
  encoding: "utf-8",
});

await cmd(
  "python3 -c \"import os,signal,subprocess; [os.kill(int(p), signal.SIGTERM) for p in subprocess.getoutput('pgrep -f trainfabric/autorunner_daemon.py').split() if p.isdigit()]; print('killed')\"",
);
await cmd(
  "python3 -c \"import subprocess; subprocess.Popen(['python3','/home/user/trainfabric/autorunner_daemon.py'], stdout=open('/tmp/autorunner.log','w'), stderr=subprocess.STDOUT, start_new_session=True); print('spawned')\"",
);
await new Promise((r) => setTimeout(r, 4000));
await cmd(
  "ps aux | grep autorunner_daemon | grep -v grep; echo ---; tail -n 40 /tmp/autorunner.log; echo ---; curl -sS -o /tmp/ua-test.txt -w '%{http_code}' -H 'User-Agent: Mozilla/5.0' -H \"Authorization: Bearer $TF_TOKEN\" \"$TF_API_URL/auto/$AUTORUN_ID\" ; echo; head -c 300 /tmp/ua-test.txt; echo; curl -sS -o /tmp/ua-bad.txt -w 'bad_ua:%{http_code}' -H \"Authorization: Bearer $TF_TOKEN\" \"$TF_API_URL/auth/whoami\"; echo; head -c 200 /tmp/ua-bad.txt",
);
