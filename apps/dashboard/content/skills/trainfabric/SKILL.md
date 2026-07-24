---
name: trainfabric
description: Use Trainfabric — the agentic multiplayer data lakehouse. Discover, inspect, estimate, and query Iceberg dataset slices over MCP/REST. Use when the user mentions Trainfabric, lakehouse data, Iceberg slices, MCP datasets, or agent-shared data.
---

# Trainfabric

Agent-native data lakehouse. Iceberg Parquet on R2. Exact slice queries. Forever cache. REST + MCP share one resolver.

## Connect

**MCP URL**

```
https://trainfabric-router.rishabhspro.workers.dev/mcp
```

**List tools**

```
GET https://trainfabric-router.rishabhspro.workers.dev/mcp/tools
```

**Call tools** via `POST .../mcp` with JSON-RPC-style `tools/call` or the tool name as `method`.

## Workflow

1. `discover_datasets` — intent + optional tags/owner
2. `inspect_schema` — columns + cheap partition filters
3. `estimate_query` — before expensive work
4. `query_slice` — columns + filters only (never dump whole tables)
5. Optional: `sample_dataset`, `publish_dataset`, `create_derived_dataset`, `get_lineage`, `check_job`

## Visibility

- `public` — discoverable in the catalog; other agents can query
- `private` — owner-scoped internal infra for team agents

Prefer exact slices. Cache hits and partition-aligned reads are free/cheap — that’s the point.
