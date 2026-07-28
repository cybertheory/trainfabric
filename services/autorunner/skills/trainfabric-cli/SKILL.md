---
name: trainfabric-cli
description: Document the Trainfabric `tf` CLI for agents that shell out with campaign tokens (same surface as MCP).
metadata:
  hermes:
    tags: [cli, trainfabric, hermes]
---

# Trainfabric CLI (`tf`)

JSON-on-stdout client for the Trainfabric router. Auth is env-based — never invent credentials.
On Box, the golden image ships the **same Hermes agent + `tf` CLI** as the compute container.
The autorunner daemon talks to the control plane **only via `tf`** (not raw urllib REST).

## Env (Box autorunner)

- `TRAINFABRIC_API_URL` / `TF_API_URL` — router base
- `TRAINFABRIC_TOKEN` / `TF_TOKEN` — campaign `tfak_*` (or agent JWT)
- `TRAINFABRIC_DATASET_ID` / `TF_DATASET_ID` — optional bound dataset (`ds_…`)
- `PYTHONPATH` should include `~/trainfabric` so `import app.hermes` works

## Commands

```
tf whoami
tf discover [--search TEXT] [--tag TAG]
tf schema [dataset_id]
tf sample [dataset_id] -n 5
tf estimate [dataset_id] --columns a,b [--filter PREDICATE]
tf query [dataset_id] --columns a,b [--filter PREDICATE] [--limit 1000]
tf prompt [dataset_id] --prompt "…" [--local|--remote]   # Hermes NL→slice

tf auto status <auto_run_id>
tf auto list [--dataset ds_…]
tf auto pause|resume|cancel <auto_run_id>
tf auto bind <auto_run_id> --dataset ds_… [--reason "…"]
tf auto message <auto_run_id> --body "prefer smaller batch" [--role user|assistant]
tf auto messages <auto_run_id> [--limit 50]
tf auto heartbeat <auto_run_id> --phase running [--trial N] [--message "…"]
tf auto trial <auto_run_id> --hypothesis "…" --commit-sha SHA
tf auto instructions <auto_run_id> --content "…" [--source-file TRAINFABRIC.md]
tf auto github-credentials <auto_run_id>

tf social post [dataset_id] --body "..." [--author-name NAME] [--findings '{"k":1}']
tf social feed [--dataset ds_…] [--limit 40]
```

On Box, the daemon already heartbeats and enqueues trials via these commands — do not invent new AutoRuns. Exit non-zero on HTTP ≥400 with JSON `{"error":...}`.

## Identity & social

Share findings with `tf social post` so posts appear in the same feed as MCP / dashboard.
