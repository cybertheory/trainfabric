# Trainfabric autorunner (Box daemon)

The **long `/auto` agent loop** (`autorunner_daemon.py`) runs inside a [Box](https://box.ascii.dev/) sandbox.

The **GPU trial worker** lives in a separate public repo (clone and run on any GPU machine):

→ **[github.com/cybertheory/trainfabric-gpu-runner](https://github.com/cybertheory/trainfabric-gpu-runner)**

| Artifact | Where | Role |
|----------|-------|------|
| `autorunner_daemon.py` (this folder) | Box sandbox | Clone research repo, load brief, discover datasets, enqueue trials, ratchet git |
| `gateway.py` + `agent_mutate.py` | Box sandbox | Hermes-parity Cloudflare AI Gateway mutate loop + `artifacts/viz/` publish |
| `skills/*` | Box sandbox | `autoresearch-mutate`, `publish-viz-github`, `trainfabric-cli` |
| [trainfabric-gpu-runner](https://github.com/cybertheory/trainfabric-gpu-runner) | Your GPU / Spark / rented box | Heartbeat, claim, run entrypoint, report score |

Docs: `/docs/agents`. MCP: `register_gpu_runner` / `list_gpu_runners` / `start_auto` with `compute.provider: "runner"`.

## Box golden template

Campaign sandboxes **fork** a stopped golden Box (filesystem + packages, no secrets).

```bash
# Build / refresh the template (needs BOX_API_KEY)
node scripts/box-golden-bootstrap.mjs

# Point the Worker at it
cd services/router
printf '%s' 'bx_…' | wrangler secret put BOX_TEMPLATE_ID
```

Each `POST /auto` mints a durable `tfak_*` API key for the owner (`autorun:{id}`), injects it as `TF_TOKEN` into the fork, and revokes it when the campaign is cancelled or completes its trial budget. Soft-refresh still curls latest autorunner files from `main` after fork so you can iterate without rebuilding the image every time.

## Box daemon env

Started with env from the router on `POST /auto`:

`AUTORUN_ID`, `TF_API_URL`, `TF_TOKEN` (campaign `tfak_*`), `TF_DATASET_ID` (optional), `AUTORUN_GOAL` (optional override), `PROTOCOL_JSON`, `REPO_URL`, `REPO_FULL_NAME`, `REPO_BRANCH`, `GITHUB_TOKEN` (short-lived App installation token), `GITHUB_INSTALLATION_ID`.

Cloudflare AI Gateway (Hermes parity): `CF_ACCOUNT_ID`, `CF_AI_GATEWAY_ID`, `CF_AI_GATEWAY_TOKEN`, optional `CF_AI_GATEWAY_BASE` / `CF_AI_MODEL`. Injected by the router from Worker secrets/vars when provisioning Box.

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

## Modal

Deploy the trial web endpoint, then point the Worker at it:

```bash
modal token set --token-id ak-… --token-secret as-… --profile=rishabhspro
modal profile activate rishabhspro
modal deploy services/autorunner/modal_trial.py
```

Worker secrets:

- `MODAL_TOKEN` — `token_id:token_secret` (or proxy token `wk-…:ws-…`)
- `MODAL_APP_REF` — the printed `https://…--run-trial.modal.run` URL

`compute.provider: "trainfabric_gpu"` (legacy `"modal"`) POSTs trial kwargs to that URL; the function clones the
research repo, runs the entrypoint, and POSTs `/auto/:id/trials/:trialId/complete`.
