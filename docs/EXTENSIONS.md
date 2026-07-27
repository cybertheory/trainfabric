# Extension points (documented, not built in MVP core beyond interfaces)

## Deferred / interface-stable

1. **Nessie/Polaris branching** — `catalog.py` REST backend + `ENABLE_BRANCHING`; SQL catalog is default.
2. **Warm NVMe tier** — `WarmRouterDO` + warm Container; promotion on hot threshold.
3. **Semantic discovery** — Vectorize + Workers AI; `discover_datasets` signature unchanged.
4. **Hybrid derived materialization** — materialize only Case-B subtrees; MVP is whole-spec pointer-or-materialize.
5. **Multi-writer hardening beyond CatalogDO** — DO serializes commits; further optimistic-retry tuning as needed.
6. **Auto-rebuild materialized views on source change** — MVP has manual rebuild + "sources advanced" indicator.
7. **Autoresearch `/auto`** — AutoRun + Box + Modal/HTTP GPU runners + GitHub App install/callback/create-repo shipped; multi-fork parallel trials and budget enforcement next.
