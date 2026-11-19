# Trainfabric autorunner (Box daemon)

The **long `/auto` agent loop** (`autorunner_daemon.py`) runs inside a [Box](https://box.ascii.dev/) sandbox.

The **GPU trial worker** lives in a separate public repo (clone and run on any GPU machine):

→ **[github.com/cybertheory/trainfabric-gpu-runner](https://github.com/cybertheory/trainfabric-gpu-runner)**

| Artifact | Where | Role |
|----------|-------|------|
| `app/hermes/` + `app/tf_cli/` (from compute) | Box golden image | **Same Hermes agent + `tf` CLI** as the query container |
| `autorunner_daemon.py` (this folder) | Box sandbox | Clone research repo, load brief, discover/bind via `tf`, Hermes prompt, enqueue trials via `tf auto trial`, ratchet git |
| `gateway.py` + `agent_mutate.py` | Box sandbox | Mutate loop (uses `app.hermes.gateway`) + `artifacts/viz/` publish |
| Official skill | `apps/dashboard/content/skills/trainfabric` (also on Box as `~/trainfabric/skills/trainfabric.md`) | **Same skill** Cursor agents install — MCP/`tf` primary, API fallback |
| `duckdb-analytics` | Hermes compute (internal) | NL→DuckDB planner only — not the public skill |
| [trainfabric-gpu-runner](https://github.com/cybertheory/trainfabric-gpu-runner) | Your GPU / Spark / rented box | Heartbeat, claim, run entrypoint, report score |

Docs: `/docs/agents`. MCP: `register_gpu_runner` / `list_gpu_runners` / `start_auto` with `compute.provider: "runner"`.

## Box golden template

Campaign sandboxes **fork** a stopped golden Box (filesystem + packages, no secrets).

The golden image installs Hermes/`tf` deps into `~/trainfabric/.venv` (PEP 668 / Debian-managed Python cannot use system `pip`).

```bash
# Build / refresh the template (needs BOX_API_KEY)
node scripts/box-golden-bootstrap.mjs

# Point the Worker at it
cd services/router
printf '%s' 'bx_…' | wrangler secret put BOX_TEMPLATE_ID
```

Each `POST /auto` mints a durable `tfak_*` API key for the owner (`autorun:{id}`), injects it as `TF_TOKEN` / `TRAINFABRIC_TOKEN` into the fork, and revokes it when the campaign is cancelled or completes its trial budget. Soft-refresh curls latest autorunner + Hermes/`tf` files from `main` after fork (and ensures the venv deps are present).

## Box daemon env

Started with env from the router on `POST /auto`:

`AUTORUN_ID`, `TF_API_URL` / `TRAINFABRIC_API_URL`, `TF_TOKEN` / `TRAINFABRIC_TOKEN` (campaign `tfak_*`), `TF_DATASET_ID` (optional), `AUTORUN_GOAL` (optional override), `PROTOCOL_JSON`, `REPO_URL`, `REPO_FULL_NAME`, `REPO_BRANCH`, `GITHUB_TOKEN` (short-lived App installation token), `GITHUB_INSTALLATION_ID`.

Cloudflare AI Gateway (same Hermes compute secrets): `CF_ACCOUNT_ID`, `CF_AI_GATEWAY_ID`, `CF_AI_GATEWAY_TOKEN`, optional `CF_AI_GATEWAY_BASE` / `CF_AI_MODEL`. Injected by the router when provisioning Box.

The daemon uses **`tf` only** for control-plane calls (discover, bind, heartbeat, trial enqueue, social, local Hermes `tf prompt`). Do not add hand-rolled urllib REST.

On push failure the daemon calls `POST /auto/:id/github-credentials` to refresh the token.

Visualizations: mutate agent writes `artifacts/viz/*`; kept trials push with the trial commit; reverted trials still republish viz when possible.

## GitHub App setup

Create a GitHub App (Settings → Developer settings → GitHub Apps):

1. **Callback URL**: `${PUBLIC_API_BASE}/github/callback`
2. **Setup URL** (optional): same as callback
3. Enable **Request user authorization (OAuth) during installation**
4. **Webhook URL**: `${PUBLIC_API_BASE}/github/webhook` + webhook secret
5. Permissions: Repository **Contents** R/W, **Metadata** R, **Administration** R/W (create repos)
6. Install on accounts/orgs users will use from the dashboard

Worker secrets (`wrangler secret put` / `.dev.vars`):

| Secret | Purpose |
|--------|---------|
| `GITHUB_APP_ID` | App id |
| `GITHUB_APP_SLUG` | URL slug (`github.com/apps/{slug}`) |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | User OAuth during install |
| `GITHUB_APP_PRIVATE_KEY` | PEM (use `\n` for newlines in secrets) |
| `GITHUB_APP_WEBHOOK_SECRET` | HMAC for `POST /github/webhook` |
| `GITHUB_APP_STATE_SECRET` | Signed install `state` |
| `GITHUB_TOKEN_CRYPTO_KEY` | AES-GCM key for stored user OAuth tokens |
| `DASHBOARD_URL` | Post-callback redirect origin |

Dashboard flow: **Connect GitHub** → install/authorize → pick or **Create repo** (seeds `TRAINFABRIC.md`, `protocol.yaml`, `AGENTS.md`) → `POST /auto` with `installationId` + `repoFullName`.

## Status: push, not cron-poll

Sandboxes **volunteer** status to the API:

| Signal | Who pushes |
|--------|------------|
| `POST /auto/:id/heartbeat` | Box daemon (phase, trial) |
| `POST /auto/:id/messages` (role=assistant) | Box daemon talk-back |
| `POST /auto/:id/trials` + complete | Daemon / Modal / HTTP runner |
| `POST /runners/heartbeat` | HTTP GPU runners |

The dashboard **polls** `GET /auto/:id` (which also lazily fetches Box event logs for that run’s `boxId`). There is no background cron that walks all sandboxes.

## Chat routing

`POST /auto/:id/messages` looks up that AutoRun’s `boxId` / `daemonHostUrl` and POSTs to that sandbox’s `/chat` only — never a different campaign’s box.

## Modal (managed Trainfabric GPU)

The Cloudflare Worker submits trials to Modal (`compute.provider: "trainfabric_gpu"`). Modal mounts the lakehouse R2 bucket and scales to clustered GPUs when the job is large.

```bash
# One-time: R2 credentials for CloudBucketMount
modal secret create trainfabric-r2 \
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

# Deploy (set R2_ENDPOINT / R2_BUCKET for your account)
export R2_ENDPOINT=https://<ACCOUNT>.r2.cloudflarestorage.com
export R2_BUCKET=trainfabric-data
# optional: TF_MODAL_GPU=H100:8 TF_MODAL_NODES=2 TF_CLUSTER_BYTES=1073741824
modal token set --token-id ak-… --token-secret as-… --profile=rishabhspro
modal profile activate rishabhspro
modal deploy services/autorunner/modal_trial.py
```

Worker secrets:

- `MODAL_TOKEN` — `token_id:token_secret` (or proxy token `wk-…:ws-…`)
- `MODAL_APP_REF` — the printed `https://…--run-trial.modal.run` URL

Flow: Worker POSTs trial kwargs (optional `data_spec` / `estimated_bytes` / `gpu_nodes`) → Modal web endpoint **spawns** cpu / gpu / clustered function with **CloudBucketMount** at `/mnt/r2` → clones repo → resolves `artifacts/data_spec.json` → runs entrypoint → POSTs `/auto/:id/trials/:trialId/complete`.

Agent writes `artifacts/data_spec.json` with `s3://trainfabric-data/…` (no secrets). Large `size_bytes` or `gpuNodes > 1` selects the clustered tier.
