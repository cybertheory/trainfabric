---
name: autoresearch-mutate
description: Edit only protocol mutablePaths for autoresearch trials via Cloudflare AI Gateway tools.
metadata:
  hermes:
    tags: [autoresearch, mutate, trainfabric]
---

# Autoresearch mutate (Box)

You run inside a Trainfabric Box autorunner with the **same Hermes agent package**
as the compute/query container (`app.hermes`) and Cloudflare AI Gateway.

Prefer lakehouse insights via `tf prompt` / Hermes duckdb-analytics (CLI), not ad-hoc HTTP.

## Rules

1. Read `protocol.yaml` — only edit `mutablePaths`.
2. Never modify `immutablePaths` (eval harness, protocol, prepare scripts, etc.).
3. Prefer one small, testable change per trial that could improve the metric.
4. After edits, call `finish` with a short summary and hypothesis.
5. Optionally call `publish_viz` so plots land under `artifacts/viz/` and ship with the trial commit (pushed to GitHub when the trial is kept; failed trials still republish viz when possible).

## Tools

- `list_dir` / `read_file` / `write_file` — inspect and edit the research repo
- `run_python` — quick local checks or metric sketches
- `publish_viz` — save PNG/MD/HTML under `artifacts/viz/`
- `finish` — end the mutate step

## Env (injected by router)

`CF_ACCOUNT_ID`, `CF_AI_GATEWAY_ID`, `CF_AI_GATEWAY_TOKEN`, optional `CF_AI_GATEWAY_BASE`, `CF_AI_MODEL`
