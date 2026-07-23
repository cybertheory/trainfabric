# Trainfabric — Agent-Native Data Lakehouse

Publish datasets as **Apache Iceberg** Parquet on **Cloudflare R2**. Agents and humans query **exact slices** (columns + filters). The router serves:

- **Case A (zero compute):** partition/stat-aligned → presigned URLs / byte-range manifests
- **Case B (compute):** ephemeral Container runs DuckDB → Arrow stream or cached Parquet link
- **Cache:** identical queries never recompute

Two front doors share one resolver: **REST** + **MCP**.

## Monorepo

```
apps/dashboard          Next.js + Clerk + Convex + shadcn/ui
services/router         Cloudflare Worker (REST + MCP + CatalogDO + WarmRouterDO)
services/compute        Python Container (PyIceberg + DuckDB)
packages/shared         Shared TS contracts + queryHash
convex/                 Control-plane registry / cache / jobs
fixtures/               Canonical test datasets
```

## Quick start

```bash
pnpm install
pnpm --filter @trainfabric/shared build
pnpm --filter @trainfabric/shared test
pnpm --filter @trainfabric/router test

# Compute (local)
cd services/compute
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ICEBERG_CATALOG_URI=sqlite:////tmp/iceberg.db
export ICEBERG_WAREHOUSE=file:///tmp/warehouse
mkdir -p /tmp/warehouse
uvicorn app.main:app --port 8080

# Router
cp services/router/.dev.vars.example services/router/.dev.vars
pnpm --filter @trainfabric/router dev

# Dashboard
cp apps/dashboard/.env.example apps/dashboard/.env.local
pnpm --filter @trainfabric/dashboard dev
```

## Architecture

**Data plane:** R2 (bytes) · Worker router · Compute Container  
**Control plane:** Convex (registry/cache/jobs) · Clerk (auth) · Postgres (Iceberg SQL catalog)

All Iceberg access goes through `services/compute/app/catalog.py`.  
All table writes go through `CatalogDO` (per-dataset Durable Object).

See the task brief for Phase-2: semantic discovery (Vectorize), warm cache, REST catalog branching, derived datasets.

## Env checklist

| Secret | Where |
|--------|--------|
| R2 account/keys/bucket | compute + router |
| Postgres / `ICEBERG_CATALOG_URI` | compute |
| `CONVEX_URL` + `CONVEX_SERVICE_KEY` | router |
| Clerk publishable/secret + JWT issuer | dashboard + router + Convex |
| `STREAM_SIZE_THRESHOLD_BYTES` | compute + router (default 50MB) |

## Tests

- Shared query-hash: `pnpm --filter @trainfabric/shared test` (≥90% coverage gate)
- Router resolver: `pnpm --filter @trainfabric/router test`
- Compute: `cd services/compute && pytest`
- CI: `.github/workflows/ci.yml` (ts + py matrix, MinIO + Postgres services)

Golden path (§13.9): publish → discover → estimate (A) → slice → estimate (B) → slice → cache hit.

## MCP tools

`POST /mcp` on the router exposes:

`discover_datasets` · `inspect_schema` · `estimate_query` · `query_slice` · `sample_dataset` · `publish_dataset` · `check_job` · `create_derived_dataset` · `preview_derived` · `get_lineage`

## Deploy

```bash
# Convex
npx convex deploy

# Worker + bindings (R2, DO, Vectorize, AI)
pnpm --filter @trainfabric/router deploy

# Dashboard (Vercel / Cloudflare Pages)
pnpm --filter @trainfabric/dashboard build
```
