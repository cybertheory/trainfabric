#!/usr/bin/env node
/** Hotfix UA + restart daemons on a live AutoRun Box. */
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

const boxId = process.argv[2] || "bx_5grk9g39";
const base = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const tfCli = readFileSync(join(root, "services/compute/app/tf_cli/__init__.py"), "utf8");

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
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
  if (!res.ok || json.ok === false) {
    throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 400)}`);
  }
  return json;
}

async function cmd(command) {
  console.log("\n$", command.slice(0, 160));
  const r = await req("POST", `/boxes/${boxId}/commands`, { command });
  console.log((r.stdout || "") + (r.stderr ? `\nSTDERR ${r.stderr}` : ""));
  return r;
}

console.log("pushing local tf_cli with browser UA…");
await req("PUT", `/boxes/${boxId}/files`, {
  path: "trainfabric/app/tf_cli/__init__.py",
  content: tfCli,
  encoding: "utf-8",
});

await cmd(
  [
    "export PATH=\"$HOME/trainfabric/bin:$HOME/trainfabric/.venv/bin:$HOME/.local/bin:$PATH\"",
    "export PYTHONPATH=\"$HOME/trainfabric${PYTHONPATH:+:$PYTHONPATH}\"",
    "export HERMES_SKILLS_DIR=\"$HOME/trainfabric/app/hermes/skills\"",
    "PY=\"$HOME/trainfabric/.venv/bin/python3\"",
    "test -x \"$PY\" || PY=python3",
    "python3 -c \"import os,signal,subprocess; [os.kill(int(p), signal.SIGTERM) for p in subprocess.getoutput('pgrep -f trainfabric/autorunner_daemon.py|trainfabric/chat_shim.py').split() if p.isdigit()]; print('killed')\"",
    "$PY -c \"import os,subprocess; home=os.path.expanduser('~'); env=os.environ.copy(); env['PATH']=f\\\"{home}/trainfabric/bin:{home}/trainfabric/.venv/bin:{home}/.local/bin:\\\"+env.get('PATH',''); env['PYTHONPATH']=f\\\"{home}/trainfabric:\\\"+env.get('PYTHONPATH',''); env.setdefault('HERMES_SKILLS_DIR', f'{home}/trainfabric/app/hermes/skills'); py=f'{home}/trainfabric/.venv/bin/python3' if os.path.isfile(f'{home}/trainfabric/.venv/bin/python3') else 'python3'; subprocess.Popen([py, f'{home}/trainfabric/chat_shim.py'], stdout=open('/tmp/tf-chat.log','w'), stderr=subprocess.STDOUT, start_new_session=True, env=env); subprocess.Popen([py, f'{home}/trainfabric/autorunner_daemon.py'], stdout=open('/tmp/autorunner.log','w'), stderr=subprocess.STDOUT, start_new_session=True, env=env); print('spawned', py)\"",
  ].join(" && "),
);

await new Promise((r) => setTimeout(r, 4000));
await cmd(
  [
    "grep -n User-Agent ~/trainfabric/app/tf_cli/__init__.py | head -2",
    "pgrep -af 'autorunner_daemon|chat_shim' | grep -v bash || true",
    "tail -n 40 /tmp/autorunner.log 2>/dev/null || true",
    "tail -n 20 /tmp/tf-chat.log 2>/dev/null || true",
    "export PATH=\"$HOME/trainfabric/bin:$HOME/trainfabric/.venv/bin:$PATH\" PYTHONPATH=\"$HOME/trainfabric\"",
    "tf --help >/dev/null && echo tf_ok",
    "curl -sS -o /tmp/whoami.json -w 'whoami:%{http_code}\\n' -H \"Authorization: Bearer $TF_TOKEN\" -H 'User-Agent: Mozilla/5.0 (compatible; TrainfabricTfCli/1.0)' \"$TF_API_URL/auth/whoami\" || true",
    "head -c 200 /tmp/whoami.json; echo",
  ].join("; "),
);
