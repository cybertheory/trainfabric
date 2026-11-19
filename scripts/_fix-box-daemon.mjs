#!/usr/bin/env node
/** Fix daemon on an already-provisioned Box (process-group SIGTERM workaround). */
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

const boxId = process.argv[2] || "bx_92vqgdad";
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
  console.log("\n$ " + command.slice(0, 120));
  const r = await box("POST", `/boxes/${boxId}/commands`, { command });
  const out = (r.stdout || "") + (r.stderr ? "\nSTDERR:\n" + r.stderr : "");
  console.log(out || JSON.stringify(r).slice(0, 800));
  return r;
}

const info = await box("GET", `/boxes/${boxId}`);
const b = info.box || info;
console.log("box", { id: b.id, state: b.state || b.status });

await cmd(
  "systemctl --user status trainfabric-autorunner 2>&1 | head -30; ls -la ~/.config/systemd/user/ 2>&1 | head -20",
);

// Prefer systemd; else setsid so Box command SIGTERM doesn't kill children
await cmd(
  [
    "mkdir -p ~/trainfabric/inbox ~/trainfabric/skills",
    "systemctl --user stop trainfabric-autorunner 2>/dev/null || true",
    "pkill -f 'chat_shim.py' 2>/dev/null || true",
    "pkill -f 'autorunner_daemon.py' 2>/dev/null || true",
    "true",
  ].join("; "),
);

const systemdStart = await cmd(
  "systemctl --user start trainfabric-autorunner 2>&1; systemctl --user is-active trainfabric-autorunner 2>&1",
);

if (!String(systemdStart.stdout || "").includes("active")) {
  // Write a launcher that fully detaches from the Box command session
  await cmd(
    [
      "cat > /tmp/tf-launch.sh <<'EOF'",
      "#!/bin/bash",
      "cd $HOME",
      "nohup python3 $HOME/trainfabric/chat_shim.py >/tmp/tf-chat.log 2>&1 &",
      "nohup python3 $HOME/trainfabric/autorunner_daemon.py >/tmp/autorunner.log 2>&1 &",
      "disown -a",
      "EOF",
      "chmod +x /tmp/tf-launch.sh",
      "setsid /tmp/tf-launch.sh </dev/null >/tmp/tf-launch.out 2>&1",
      "sleep 1",
      "ps aux | grep -E 'autorunner|chat_shim' | grep -v grep || echo NO_PROCS",
    ].join("\n"),
  );
}

await cmd(
  "ps aux | grep -E 'autorunner|chat_shim|python3' | grep -v grep | head -20; echo ---; tail -n 50 /tmp/autorunner.log 2>/dev/null || echo no_log; echo ---; ss -ltnp 2>/dev/null | grep 8787 || netstat -ltn 2>/dev/null | grep 8787 || echo no_8787",
);

const hosted = await cmd("host 8787 --private 2>&1 || true");
const m = String(hosted.stdout || "").match(/https:\/\/\S+/);
console.log("\ndaemonHostUrl candidate:", m?.[0] || "(none)");
