#!/usr/bin/env node
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
const base = (vars.PUBLIC_API_BASE || "https://trainfabric-router.rishabhspro.workers.dev").replace(
  /\/$/,
  "",
);
const boxBase = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");
const runId = process.argv[2] || "auto_d83839ac48d5";
const subject = "user_3H1i74IdIFMqzzZ5VpXd6YFVKGh";
const token = await new SignJWT({ email: "rishabhspro@gmail.com", scope: ["datasets:read", "trainfabric"] })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(subject)
  .setIssuer("trainfabric-agent")
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(new TextEncoder().encode(vars.AGENT_TOKEN_SECRET));

const detail = await fetch(`${base}/auto/${runId}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
}).then((r) => r.json());
const run = detail.run || detail;
console.log(
  JSON.stringify(
    {
      id: run.id,
      ownerId: run.ownerId,
      status: run.status,
      box: run.box,
      progress: run.progress,
      trials: (detail.trials || []).map((t) => ({
        id: t.id,
        status: t.status,
        score: t.score,
        sha: t.commitSha?.slice?.(0, 8),
      })),
      activityTail: (detail.activity || []).slice(-6).map((a) => a.message),
    },
    null,
    2,
  ),
);

const boxId = run.box?.boxId;
if (boxId) {
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
  const b = info.box || info;
  console.log("boxState", b.state || b.status);
  let ps = await bcmd(
    "ps aux | grep -E 'autorunner_daemon|chat_shim' | grep -v grep; echo ---; tail -n 60 /tmp/autorunner.log 2>/dev/null || echo no_log",
  );
  console.log("procs/log:\n", ps.stdout || JSON.stringify(ps).slice(0, 1200));
  if (!String(ps.stdout || "").includes("autorunner_daemon")) {
    console.log("spawning daemon…");
    await bcmd(
      "python3 -c \"import subprocess; subprocess.Popen(['python3', __import__('os').path.expanduser('~/trainfabric/chat_shim.py')], stdout=open('/tmp/tf-chat.log','a'), stderr=subprocess.STDOUT, start_new_session=True); subprocess.Popen(['python3', __import__('os').path.expanduser('~/trainfabric/autorunner_daemon.py')], stdout=open('/tmp/autorunner.log','a'), stderr=subprocess.STDOUT, start_new_session=True); print('ok')\"",
    );
    await new Promise((r) => setTimeout(r, 2500));
    ps = await bcmd(
      "ps aux | grep -E 'autorunner_daemon|chat_shim' | grep -v grep; echo ---; head -80 /tmp/autorunner.log; echo ---; (ss -ltn || netstat -ltn) 2>/dev/null | grep 8787 || true",
    );
    console.log("after spawn:\n", ps.stdout || JSON.stringify(ps).slice(0, 1500));
    const hosted = await bcmd("host 8787 --private 2>&1 || true");
    console.log("host:", hosted.stdout || hosted.stderr || hosted);
  }
}
