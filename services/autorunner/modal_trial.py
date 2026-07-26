"""
Trainfabric Modal trial runner — GPU (or CPU) execution for /auto trials.

Deploy:
  modal deploy services/autorunner/modal_trial.py

The Cloudflare Worker POSTs trial kwargs to the web endpoint (MODAL_APP_REF).
This function clones the research repo, runs the entrypoint, and POSTs the
result to callback_url (same contract as trainfabric-gpu-runner).
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

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install("numpy", "scikit-learn")
)

app = modal.App("trainfabric-trial", image=image)


def _post_json(url: str, body: dict[str, Any], token: Optional[str] = None) -> Any:
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "trainfabric-modal-trial/1.0",
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


def _run_entrypoint(repo: Path, entrypoint: str, budget_sec: int) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            entrypoint,
            shell=True,
            cwd=str(repo),
            text=True,
            capture_output=True,
            timeout=budget_sec,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
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
) -> dict[str, Any]:
    """Clone repo @ sha, run entrypoint, report to callback_url."""
    _ = env  # reserved for dataset tokens / TF_API_URL later
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
            result = _run_entrypoint(repo, entrypoint, int(budget_sec))

    payload = {
        "status": result["status"],
        "score": result.get("score"),
        "error": result.get("error"),
        "commitSha": commit_sha,
    }
    if callback_url:
        try:
            _post_json(callback_url, payload)
        except Exception as e:  # noqa: BLE001
            result = {
                **result,
                "callback_error": str(e)[:500],
            }
    return {
        "trial_id": trial_id,
        "auto_run_id": auto_run_id,
        **result,
        "payload": payload,
    }


@app.function(timeout=3600, cpu=2, memory=4096)
@modal.fastapi_endpoint(method="POST")
def run_trial(item: dict[str, Any]) -> dict[str, Any]:
    """
    Web entrypoint for the Trainfabric Worker.

    Accepts either a flat trial body or {args:[], kwargs:{...}} from the
    Modal-style invoke wrapper used by computeProviders.
    """
    body = item.get("kwargs") if isinstance(item.get("kwargs"), dict) else item
    return execute_trial(
        trial_id=str(body.get("trial_id") or ""),
        auto_run_id=str(body.get("auto_run_id") or ""),
        repo_url=str(body.get("repo_url") or ""),
        commit_sha=body.get("commit_sha"),
        entrypoint=str(body.get("entrypoint") or "python train.py"),
        budget_sec=int(body.get("budget_sec") or 600),
        callback_url=str(body.get("callback_url") or ""),
        env=body.get("env") if isinstance(body.get("env"), dict) else {},
    )
