---
name: trainfabric-cli
description: Document the Trainfabric `tf` CLI for agents that shell out to REST with user-scoped agent tokens.
metadata:
  hermes:
    tags: [cli, trainfabric, rest]
---

# Trainfabric CLI (`tf`)

JSON-on-stdout client for the Trainfabric router. Auth is env-based — never invent credentials.

## Env

- `TRAINFABRIC_API_URL` — router base (e.g. `https://trainfabric-router.rishabhspro.workers.dev`)
- `TRAINFABRIC_TOKEN` — short-lived agent JWT (or Clerk session JWT)
- `TRAINFABRIC_DATASET_ID` — optional default dataset id (`ds_…`)

## Commands

```
tf whoami
tf discover [--search TEXT] [--tag TAG]
tf schema [dataset_id]
tf sample [dataset_id] -n 5
tf estimate [dataset_id] --columns a,b [--filter PREDICATE]
tf query [dataset_id] --columns a,b [--filter PREDICATE] [--limit 1000]
```

Typical flow: `schema` → `estimate` → `query`. Prefer partition-aligned filters. Exit non-zero on HTTP ≥400 with JSON `{"error":...}`.
