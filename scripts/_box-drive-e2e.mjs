#!/usr/bin/env node
/** Drive Box sandbox through ingest verify + trial enqueue for e2e. */
import { readFileSync, writeFileSync } from "node:fs";
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

const boxId = process.argv[2] || "bx_qdyufgmf";
const datasetId = process.argv[3] || "ds_b5e6abdbabf04bf4";
const autoRunId = process.argv[4] || "auto_f790472dca81";
const baseBox = (vars.BOX_API_BASE || "https://ascii.dev/api/box/v1").replace(/\/$/, "");

async function boxCmd(command, timeoutMs = 300000) {
  const res = await fetch(`${baseBox}/boxes/${boxId}/commands`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vars.BOX_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ command, timeout_ms: timeoutMs }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  console.log(
    JSON.stringify(
      {
        http: res.status,
        exit: json.exitCode ?? json.exit_code,
        stdout: String(json.stdout || "").slice(-4000),
        stderr: String(json.stderr || "").slice(-1500),
      },
      null,
      2,
    ),
  );
  return json;
}

console.log("=== env / hermes ===");
await boxCmd(
  "env | grep -E '^(AUTORUN|TF_|TRAINFABRIC|REPO_)' | sed 's/=\\(tfak_\\).*/=\\1***/;s/=\\(tfr_\\).*/=\\1***/;s/TOKEN=.*/TOKEN=***/' ; which tf; pip3 show httpx 2>/dev/null | head -2; python3 -c 'import httpx; print(httpx.__version__)' 2>&1 | head -2",
);

console.log("=== install httpx if missing ===");
await boxCmd("pip3 install -q httpx 2>&1 | tail -5");

console.log("=== ingest via API with campaign token ===");
await boxCmd(
  `python3 - <<'PY'
import json, os, urllib.request
base=os.environ.get("TF_API_URL") or os.environ.get("TRAINFABRIC_API_URL")
tok=os.environ.get("TF_TOKEN") or os.environ.get("TRAINFABRIC_TOKEN")
print("base", base, "tok_prefix", (tok or "")[:8])
req=urllib.request.Request(
  base.rstrip("/")+"/datasets",
  data=json.dumps({
    "name":"hf-iris-box-e2e",
    "description":"E2E HF iris via Box campaign key",
    "tags":["e2e","huggingface","iris"],
    "visibility":"private",
    "source_url":"https://huggingface.co/datasets/scikit-learn/iris",
    "source_auth":"none",
  }).encode(),
  headers={"Authorization":"Bearer "+tok,"Content-Type":"application/json","Accept":"application/json"},
  method="POST",
)
try:
  with urllib.request.urlopen(req, timeout=120) as r:
    print(r.status, r.read().decode()[:1500])
except Exception as e:
  if hasattr(e,"read"):
    print("err", e.code if hasattr(e,"code") else e, e.read().decode()[:1500])
  else:
    print("err", e)
PY`,
);

console.log("=== schema/sample bound dataset ===");
await boxCmd(
  `tf schema ${datasetId} 2>&1 | tail -40; echo ---; tf sample ${datasetId} --n 2 2>&1 | tail -40`,
);

console.log("=== query + write data_spec + trial ===");
await boxCmd(
  `
set -e
cd ~/work 2>/dev/null || cd /tmp
# prefer research clone if present
REPO=$(find /tmp /home -maxdepth 4 -type d -name trainfabric-e2e-smoke 2>/dev/null | head -1)
if [ -z "$REPO" ]; then
  git clone --depth 1 https://github.com/cybertheory/trainfabric-e2e-smoke.git /tmp/trainfabric-e2e-smoke
  REPO=/tmp/trainfabric-e2e-smoke
fi
cd "$REPO"
echo REPO=$REPO
# query
OUT=$(tf query ${datasetId} --limit 50 2>&1) || true
echo "$OUT" | tail -60
URL=$(echo "$OUT" | python3 -c 'import sys,json,re; t=sys.stdin.read();
m=re.search(r"https://[^\\\"\\s]+/r2/[^\\\"\\s]+", t)
print(m.group(0) if m else "")')
echo URL=$URL
if [ -n "$URL" ]; then
  KEY=$(python3 -c "from urllib.parse import urlparse; p=urlparse('$URL').path; print(p.split('/r2/',1)[1])")
  python3 -c "import json; json.dump({'uri':'s3://trainfabric-data/'+'''$KEY''','format':'parquet','size_bytes':100000}, open('artifacts/data_spec.json','w'), indent=2)"
  echo "$URL" > artifacts/data_url.txt
  cat artifacts/data_spec.json
  git add artifacts/data_spec.json artifacts/data_url.txt || true
  git -c user.email=e2e@trainfabric.dev -c user.name=e2e commit -m "e2e data handoff" || true
  git push origin HEAD || true
  SHA=$(git rev-parse HEAD)
  echo SHA=$SHA
  tf auto trial ${autoRunId} --hypothesis "e2e modal mount smoke" --commit-sha "$SHA" --data-spec-file artifacts/data_spec.json --estimated-bytes 100000 2>&1 | tail -40
else
  echo "NO_URL — dataset may still be empty/pending"
fi
`,
  420000,
);

console.log("=== done box drive ===");
