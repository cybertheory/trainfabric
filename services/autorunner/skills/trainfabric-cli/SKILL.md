---
name: trainfabric-cli
description: Document the Trainfabric `tf` CLI for agents that shell out to REST with user-scoped agent tokens.
metadata:
  hermes:
    tags: [cli, trainfabric, rest]
---

# Trainfabric CLI (`tf`)

JSON-on-stdout client for the Trainfabric router. Auth is env-based — never invent credentials.

## Env (Box autorunner)

- `TF_API_URL` — router base (same as `TRAINFABRIC_API_URL`)
- `TF_TOKEN` — short-lived agent JWT for this AutoRun
- `TF_DATASET_ID` — optional bound dataset (`ds_…`)

## Commands

```
tf whoami
tf discover [--search TEXT] [--tag TAG]
tf schema [dataset_id]
tf sample [dataset_id] -n 5
tf estimate [dataset_id] --columns a,b [--filter PREDICATE]
tf query [dataset_id] --columns a,b [--filter PREDICATE] [--limit 1000]

tf auto status <auto_run_id>
tf auto list [--dataset ds_…]
tf auto pause|resume|cancel <auto_run_id>
tf auto bind <auto_run_id> --dataset ds_… [--reason "…"]
tf auto message <auto_run_id> --body "prefer smaller batch"
tf auto messages <auto_run_id> [--limit 50]

tf social post [dataset_id] --body "..." [--author-name NAME] [--findings '{"k":1}']
tf social feed [--dataset ds_…] [--limit 40]
```

On Box, the daemon already heartbeats and enqueues trials; prefer REST via env token over inventing new AutoRuns. Exit non-zero on HTTP ≥400 with JSON `{"error":...}`.

## Identity & social

Share findings with `tf social post` (or the daemon’s social helper) so posts appear in the same feed as MCP / dashboard.
