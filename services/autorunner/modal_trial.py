"""
Trainfabric managed GPU trials on Modal.

Cloudflare Worker (compute.provider=trainfabric_gpu) POSTs to the web endpoint.
This app:
  1. Picks cpu / single-node GPU / multi-node clustered based on data size
  2. Mounts the lakehouse R2 bucket via CloudBucketMount at /mnt/r2
  3. Clones the research repo, resolves artifacts/data_spec.json (or legacy data_url)
  4. Runs the entrypoint with TF_DATA_PATH pointing at the mount
  5. POSTs completion to callback_url

Deploy:
  modal secret create trainfabric-r2 \\
    AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…
  # Optional deploy env (Modal dashboard or `modal deploy` with env):
  #   R2_BUCKET, R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
  modal deploy services/autorunner/modal_trial.py

Point Worker MODAL_APP_REF at the printed https://…--run-trial.modal.run URL.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

import modal
from modal.experimental import clustered, get_cluster_info

from tf_data import (
    DEFAULT_MOUNT,
    load_data_spec,
    pick_compute_tier,
    write_data_env,
)

R2_BUCKET = os.environ.get("R2_BUCKET", "trainfabric-data")
R2_ENDPOINT = os.environ.get(
    "R2_ENDPOINT",
    "",  # set at deploy — required for Cloudflare R2 CloudBucketMount
)
TF_MODAL_GPU = os.environ.get("TF_MODAL_GPU", "T4")
# Large-job GPU (full node when available). Defaults to same as TF_MODAL_GPU for accounts without H100 billing.
TF_MODAL_CLUSTER_GPU = os.environ.get("TF_MODAL_CLUSTER_GPU") or TF_MODAL_GPU
TF_MODAL_NODES = max(2, int(os.environ.get("TF_MODAL_NODES", "2")))
TF_ENABLE_CLUSTER = os.environ.get("TF_ENABLE_CLUSTER", "0").strip().lower() not in {
    "0",
    "false",
    "no",
}

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install(
        "fastapi[standard]",
        "numpy",
        "scikit-learn",
        "fsspec",
        "s3fs",
    )
    .add_local_file(
        Path(__file__).resolve().parent / "tf_data.py",
        remote_path="/root/tf_data.py",
    )
)

app = modal.App("trainfabric-trial", image=image)

_r2_secret = modal.Secret.from_name("trainfabric-r2")


def _r2_mount() -> modal.CloudBucketMount:
    kwargs: dict[str, Any] = {
        "bucket_name": R2_BUCKET,
        "secret": _r2_secret,
        "read_only": True,
    }
    if R2_ENDPOINT:
        kwargs["bucket_endpoint_url"] = R2_ENDPOINT
    return modal.CloudBucketMount(**kwargs)


_VOLUMES = {DEFAULT_MOUNT: _r2_mount()}


def _post_json(url: str, body: dict[str, Any], token: Optional[str] = None) -> Any:
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "trainfabric-modal-trial/2.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {url} -> {e.code}: {err[:800]}") from e


def _run_entrypoint(
    repo: Path,
    entrypoint: str,
    budget_sec: int,
    extra_env: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    env = {**os.environ, "PYTHONUNBUFFERED": "1", **(extra_env or {})}
    try:
        proc = subprocess.run(
            entrypoint,
            shell=True,
            cwd=str(repo),
            text=True,
            capture_output=True,
            timeout=budget_sec,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": f"budget exceeded ({budget_sec}s)"}

    metrics_path = repo / "metrics.json"
    score = None
    if metrics_path.exists():
        try:
            score = json.loads(metrics_path.read_text()).get("score")
        except json.JSONDecodeError:
            pass
    if proc.returncode != 0:
        return {
            "status": "error",
            "error": (proc.stderr or proc.stdout or "entrypoint failed")[:2000],
            "score": score,
        }
    return {"status": "done", "score": score}


def execute_trial(
    *,
    trial_id: str,
    auto_run_id: str,
    repo_url: str,
    commit_sha: Optional[str] = None,
    entrypoint: str = "python train.py",
    budget_sec: int = 600,
    callback_url: str = "",
    env: Optional[dict[str, str]] = None,
    data_spec: Optional[dict[str, Any]] = None,
    estimated_bytes: Optional[int] = None,
    gpu_nodes: Optional[int] = None,
    tier: Optional[str] = None,
) -> dict[str, Any]:
    """Clone repo @ sha, resolve lakehouse data on /mnt/r2, run entrypoint, callback."""
    base_env = dict(env or {})
    branch = "main"
    with tempfile.TemporaryDirectory(prefix="tf-trial-") as tmp:
        repo = Path(tmp) / "repo"
        clone = subprocess.run(
            ["git", "clone", "--depth", "50", repo_url, str(repo)],
            capture_output=True,
            text=True,
            check=False,
        )
        if clone.returncode != 0 or not repo.exists():
            result = {
                "status": "error",
                "error": f"git clone failed: {(clone.stderr or clone.stdout)[:800]}",
            }
        else:
            if commit_sha:
                subprocess.run(
                    ["git", "checkout", commit_sha],
                    cwd=str(repo),
                    capture_output=True,
                    check=False,
                )
            else:
                subprocess.run(
                    ["git", "checkout", branch],
                    cwd=str(repo),
                    capture_output=True,
                    check=False,
                )
            try:
                spec = load_data_spec(repo, mount_root=DEFAULT_MOUNT, override=data_spec)
            except Exception as e:  # noqa: BLE001
                result = {"status": "error", "error": f"data_spec: {e}"[:2000]}
            else:
                data_env = write_data_env(repo, spec)
                if estimated_bytes is None and spec and spec.size_bytes:
                    estimated_bytes = spec.size_bytes
                used_tier = tier or pick_compute_tier(
                    estimated_bytes=estimated_bytes,
                    gpu_nodes=gpu_nodes,
                    cluster=spec.cluster if spec else None,
                )
                data_env["TF_COMPUTE_TIER"] = used_tier
                is_rank0 = True
                if used_tier == "cluster":
                    # Every node mounts R2; expose ranks for distributed train.py.
                    try:
                        info = get_cluster_info()
                        data_env["TF_CLUSTER_RANK"] = str(info.rank)
                        data_env["TF_CLUSTER_SIZE"] = str(len(info.container_ips))
                        data_env["MASTER_ADDR"] = info.container_ips[0]
                        is_rank0 = int(info.rank) == 0
                    except Exception:
                        is_rank0 = True
                result = _run_entrypoint(
                    repo,
                    entrypoint,
                    int(budget_sec),
                    extra_env={**base_env, **data_env},
                )
                result["tier"] = used_tier
                result["is_rank0"] = is_rank0
                if spec:
                    result["data_uri"] = spec.uri
                    result["data_path"] = spec.mount_path

    payload = {
        "status": result["status"],
        "score": result.get("score"),
        "error": result.get("error"),
        "commitSha": commit_sha,
    }
    # Only rank 0 (or non-cluster) reports to TrainFabric — avoids duplicate completes.
    if (
        callback_url
        and result.get("status") in {"done", "error"}
        and result.get("is_rank0", True)
    ):
        try:
            _post_json(callback_url, payload)
        except Exception as e:  # noqa: BLE001
            result = {**result, "callback_error": str(e)[:500]}
    return {
        "trial_id": trial_id,
        "auto_run_id": auto_run_id,
        **result,
        "payload": payload,
    }


def _parse_body(item: dict[str, Any]) -> dict[str, Any]:
    body = item.get("kwargs") if isinstance(item.get("kwargs"), dict) else item
    return body if isinstance(body, dict) else {}


def _kwargs_from_body(body: dict[str, Any]) -> dict[str, Any]:
    data_spec = body.get("data_spec") if isinstance(body.get("data_spec"), dict) else None
    est = body.get("estimated_bytes")
    try:
        estimated_bytes = int(est) if est is not None else None
    except (TypeError, ValueError):
        estimated_bytes = None
    nodes = body.get("gpu_nodes") or body.get("cluster_nodes")
    try:
        gpu_nodes = int(nodes) if nodes is not None else None
    except (TypeError, ValueError):
        gpu_nodes = None
    return {
        "trial_id": str(body.get("trial_id") or ""),
        "auto_run_id": str(body.get("auto_run_id") or ""),
        "repo_url": str(body.get("repo_url") or ""),
        "commit_sha": body.get("commit_sha"),
        "entrypoint": str(body.get("entrypoint") or "python train.py"),
        "budget_sec": int(body.get("budget_sec") or 600),
        "callback_url": str(body.get("callback_url") or ""),
        "env": body.get("env") if isinstance(body.get("env"), dict) else {},
        "data_spec": data_spec,
        "estimated_bytes": estimated_bytes,
        "gpu_nodes": gpu_nodes,
    }


# ── Compute tiers (R2 lakehouse mounted at /mnt/r2) ─────────────────────────


@app.function(
    timeout=3600,
    cpu=2,
    memory=8192,
    volumes=_VOLUMES,
    secrets=[_r2_secret],
)
def run_trial_cpu(**kwargs: Any) -> dict[str, Any]:
    return execute_trial(**kwargs, tier="cpu")


@app.function(
    timeout=7200,
    gpu=TF_MODAL_GPU,
    memory=32768,
    volumes=_VOLUMES,
    secrets=[_r2_secret],
)
def run_trial_gpu(**kwargs: Any) -> dict[str, Any]:
    return execute_trial(**kwargs, tier="gpu")


@app.function(
    timeout=7200,
    gpu=TF_MODAL_CLUSTER_GPU,
    memory=65536,
    volumes=_VOLUMES,
    secrets=[_r2_secret],
)
def run_trial_cluster_single(**kwargs: Any) -> dict[str, Any]:
    """Large-job path: full-node multi-GPU (no multi-node fabric)."""
    return execute_trial(**kwargs, tier="cluster")


def _register_clustered():
    """Multi-node cluster — requires full GPUs/node (e.g. H100:8) + Modal cluster entitlement."""

    @app.function(
        timeout=7200,
        gpu=TF_MODAL_CLUSTER_GPU,
        memory=65536,
        volumes=_VOLUMES,
        secrets=[_r2_secret],
    )
    @clustered(size=TF_MODAL_NODES, rdma=False)
    def run_trial_cluster(**kwargs: Any) -> dict[str, Any]:
        return execute_trial(**kwargs, tier="cluster")

    return run_trial_cluster


run_trial_cluster = _register_clustered() if TF_ENABLE_CLUSTER else run_trial_cluster_single


@app.function(timeout=120, cpu=1, memory=1024)
@modal.fastapi_endpoint(method="POST")
def run_trial(item: dict[str, Any]) -> dict[str, Any]:
    """
    Worker entrypoint — dispatch to cpu / gpu / clustered Modal functions.

    Accepts flat trial body or {args:[], kwargs:{...}}. Spawns the GPU/cluster
    function and returns immediately; the worker completes via callback_url.
    """
    body = _parse_body(item)
    kwargs = _kwargs_from_body(body)

    # Prefer explicit size from Worker; else peek data_spec.size_bytes if provided.
    est = kwargs.get("estimated_bytes")
    cluster_flag = None
    if kwargs.get("data_spec"):
        cluster_flag = kwargs["data_spec"].get("cluster")
        if est is None:
            try:
                est = int(
                    kwargs["data_spec"].get("size_bytes")
                    or kwargs["data_spec"].get("estimated_bytes")
                    or 0
                ) or None
            except (TypeError, ValueError):
                est = None

    tier = pick_compute_tier(
        estimated_bytes=est,
        gpu_nodes=kwargs.get("gpu_nodes"),
        cluster=bool(cluster_flag) if cluster_flag is not None else None,
    )

    if tier == "cluster":
        call = run_trial_cluster.spawn(**kwargs)
    elif tier == "gpu":
        call = run_trial_gpu.spawn(**kwargs)
    else:
        call = run_trial_cpu.spawn(**kwargs)

    call_id = getattr(call, "object_id", None) or getattr(call, "call_id", None) or ""
    return {
        "ok": True,
        "tier": tier,
        "trial_id": kwargs["trial_id"],
        "auto_run_id": kwargs["auto_run_id"],
        "call_id": str(call_id),
        "status": "spawned",
        "cluster_mode": "multi_node" if TF_ENABLE_CLUSTER else "single_node_fat",
    }
