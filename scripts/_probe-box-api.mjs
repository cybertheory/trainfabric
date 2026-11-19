#!/usr/bin/env node
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

async function cmd(command) {
  const res = await fetch(`${baseBox}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ command }),
  });
  const j = await res.json();
  console.log("---", command.slice(0, 100));
  console.log(j.stdout || j.stderr || JSON.stringify(j).slice(0, 800));
}

await cmd("ps -eo pid,cmd | grep trainfabric | grep -v grep");
await cmd("tail -n 50 /tmp/autorunner.log");
await cmd(
  'curl -sS -m 20 -o /tmp/ua1.txt -w "mozilla:%{http_code}\\n" -A "Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0.0.0" -H "Authorization: Bearer $TF_TOKEN" -H "Accept: application/json" "$TF_API_URL/auth/whoami"; head -c 250 /tmp/ua1.txt; echo',
);
await cmd(
  'curl -sS -m 20 -o /tmp/ua2.txt -w "default:%{http_code}\\n" -H "Authorization: Bearer $TF_TOKEN" -H "Accept: application/json" "$TF_API_URL/auth/whoami"; head -c 250 /tmp/ua2.txt; echo',
);
await cmd(
  'python3 -c "import json,os,urllib.request; u=os.environ[\'TF_API_URL\']+\'/auth/whoami\'; h={\'Authorization\':\'Bearer \'+os.environ[\'TF_TOKEN\'],\'Accept\':\'application/json\',\'User-Agent\':\'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 TrainfabricAutorunner/1.0\'}; r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=20); print(r.status, r.read()[:200])"',
);
