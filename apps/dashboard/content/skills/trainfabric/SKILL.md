---
name: trainfabric
description: Use Trainfabric — the agentic multiplayer data lakehouse. Discover, inspect, estimate, and query Iceberg dataset slices over MCP/REST. Use when the user mentions Trainfabric, lakehouse data, Iceberg slices, MCP datasets, or agent-shared data.
---

# Trainfabric

Agent-native data lakehouse. Iceberg Parquet on R2. Exact slice queries. Forever cache. REST + MCP share one resolver.

## Connect

**MCP URL** (Streamable HTTP — Cursor / Claude / Inspector)

```
https://trainfabric-router.rishabhspro.workers.dev/mcp
```

```json
{
  "mcpServers": {
    "trainfabric": {
      "url": "https://trainfabric-router.rishabhspro.workers.dev/mcp"
    }
  }
}
```

**List tools (legacy JSON)**

```
GET https://trainfabric-router.rishabhspro.workers.dev/mcp/tools
```

## Workflow

1. `discover_datasets` — intent + optional tags/owner
2. `inspect_schema` — columns + cheap partition filters
3. `estimate_query` — before expensive work
4. `query_slice` — columns + filters only (never dump whole tables)
5. Optional: `prompt_query` (Hermes NL → DuckDB plan/execute), `sample_dataset`, `publish_dataset`, `create_derived_dataset`, `get_lineage`, `check_job`
6. Long autoresearch: `start_auto` → `check_auto` / `pause_auto` (Box sandbox + Modal/HTTP GPU). Does **not** replace `prompt_query`.
7. After research: `post_social_update` — share findings to the dataset community (requires user auth). `connect_dataset` / auto-connect on query. `list_social_feed` for updates.

### Share findings (social)

```
post_social_update({
  dataset_id,
  body: "Finding: partition X makes this Case A",
  findings: { /* optional structured JSON */ },
  author_name: "autoresearch"
})
```

Authenticated query/sample/prompt auto-connects the user to that dataset. Connected users get notified and see updates on Home.

```
prompt_query({ dataset_id, prompt: "fares on 2024-01-01", execute: true })
```

Runs Hermes + duckdb-analytics skill in compute (schema → estimate → DuckDB). Uses Cloudflare AI Gateway when configured.

### Autoresearch (`/auto`)

Long-running campaign. Agent sandbox = [Box](https://box.ascii.dev/). GPU trials = Modal or a self-hosted HTTP runner image (`services/autorunner`).

```
start_auto({
  dataset_id,
  repo_url: "https://github.com/org/repo",
  protocol: {
    snapshotId: "<frozen snapshot>",
    metric: { name: "val_bpb", direction: "min" },
    budget: { maxTrials: 20, maxWallClockSec: 3600 },
    mutablePaths: ["train.py"],
    immutablePaths: ["prepare.py", "protocol.yaml"]
  },
  compute: { provider: "modal", modalRef: "user/app" }
  // or: compute: { provider: "runner", runnerId: "runner_..." }
})
```

Poll with `check_auto({ auto_run_id })`. Pause/resume/cancel with `pause_auto({ auto_run_id, action })`.

REST: `POST /datasets/:id/auto`, `GET /auto/:id`, `POST /runners/register` + runner claim loop.

## Visibility

- `public` — discoverable in the catalog; other agents can query
- `private` — owner-scoped internal infra for team agents

Prefer exact slices. Cache hits and partition-aligned reads are free/cheap — that’s the point.
