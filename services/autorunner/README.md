# Trainfabric autorunner

Two processes:

| Artifact | Where it runs | Role |
|----------|---------------|------|
| `autorunner_daemon.py` | Box (ascii.dev) sandbox | Long `/auto` loop: git, `/prompt`, enqueue trials, ratchet |
| `gpu_runner.py` (+ Docker image) | Your GPU machine / Modal | Claim & execute GPU trials only |

## GPU runner (self-hosted)

```bash
# Register once (authenticated against Trainfabric)
curl -X POST "$TF_API/runners/register" \
  -H "Authorization: Bearer $CLERK_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"home-gpu","capacity":"gpu:1"}'
# → { runnerId, token }

docker build -t trainfabric/gpu-runner .
docker run --rm -e TF_API_URL=https://your-router \
  -e RUNNER_TOKEN=tfr_... \
  trainfabric/gpu-runner
```

## Box daemon

Baked into a Box template (or scp'd). Started with env from the router on `POST /datasets/:id/auto`:

`AUTORUN_ID`, `TF_API_URL`, `TF_TOKEN`, `TF_DATASET_ID`, `PROTOCOL_JSON`, `REPO_URL`, `REPO_BRANCH`.

## Modal

Point `compute.provider: "modal"` + `MODAL_TOKEN` / `MODAL_APP_REF` on the Worker. Trials complete via `POST /auto/:id/trials/:trialId/complete`.
