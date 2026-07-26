# Trainfabric autorunner (Box daemon)

The **long `/auto` agent loop** (`autorunner_daemon.py`) runs inside a [Box](https://box.ascii.dev/) sandbox.

The **GPU trial worker** lives in a separate public repo (clone and run on any GPU machine):

→ **[github.com/cybertheory/trainfabric-gpu-runner](https://github.com/cybertheory/trainfabric-gpu-runner)**

| Artifact | Where | Role |
|----------|-------|------|
| `autorunner_daemon.py` (this folder) | Box sandbox | Clone research repo, load brief, discover datasets, enqueue trials, ratchet git |
| [trainfabric-gpu-runner](https://github.com/cybertheory/trainfabric-gpu-runner) | Your GPU / Spark / rented box | Heartbeat, claim, run entrypoint, report score |

Docs: `/docs/agents`. MCP: `register_gpu_runner` / `list_gpu_runners` / `start_auto` with `compute.provider: "runner"`.

## Box daemon env

Started with env from the router on `POST /auto`:

`AUTORUN_ID`, `TF_API_URL`, `TF_TOKEN`, `TF_DATASET_ID` (optional), `AUTORUN_GOAL` (optional override), `PROTOCOL_JSON`, `REPO_URL`, `REPO_BRANCH`.

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

`compute.provider: "modal"` POSTs trial kwargs to that URL; the function clones the
research repo, runs the entrypoint, and POSTs `/auto/:id/trials/:trialId/complete`.
