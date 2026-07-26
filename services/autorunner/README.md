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

Point `compute.provider: "modal"` + `MODAL_TOKEN` / `MODAL_APP_REF` on the Worker.
