#!/usr/bin/env python3
"""
Trainfabric GPU worker — poll/claim trials from the router (NAT-friendly).

Not the long-running agent (that's Box). This only executes GPU trials.

  docker run ... -e TF_API_URL=... -e RUNNER_TOKEN=tfr_... trainfabric/gpu-runner
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional


def api(base: str, token: str, method: str, path: str, body: Optional[dict] = None) -> Any:
    url = f"{base.rstrip('/')}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> {e.code}: {err}") from e


def run_entrypoint(repo: Path, entrypoint: str, budget_sec: int) -> dict[str, Any]:
    """Run entrypoint under wall-clock budget; expect metrics.json with {score}."""
    try:
        proc = subprocess.run(
            entrypoint,
            shell=True,
            cwd=str(repo),
            text=True,
            capture_output=True,
            timeout=budget_sec,
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


def claim_loop(base: str, token: str, poll_sec: float, workdir: Path) -> None:
    while True:
        api(base, token, "POST", "/runners/heartbeat", {})
        claimed = api(base, token, "POST", "/runners/claim", {})
        trial = claimed.get("trial")
        run = claimed.get("run")
        if not trial or not run:
            time.sleep(poll_sec)
            continue

        trial_id = trial["id"]
        auto_run_id = trial["autoRunId"]
        repo_url = run["repo"]["url"]
        branch = run["repo"].get("defaultBranch") or "main"
        sha = trial.get("commitSha")
        protocol = run.get("protocol") or {}
        budget = int((protocol.get("budget") or {}).get("maxGpuSec") or 600)
        entrypoint = os.environ.get("TRIAL_ENTRYPOINT", "python train.py")

        with tempfile.TemporaryDirectory(dir=str(workdir)) as tmp:
            repo = Path(tmp) / "repo"
            subprocess.run(
                ["git", "clone", "--branch", branch, "--single-branch", repo_url, str(repo)],
                check=False,
            )
            if sha and repo.exists():
                subprocess.run(["git", "checkout", sha], cwd=str(repo), check=False)
            result = run_entrypoint(repo, entrypoint, budget)

        api(
            base,
            token,
            "POST",
            f"/auto/{auto_run_id}/trials/{trial_id}/complete",
            {
                "status": result["status"],
                "score": result.get("score"),
                "error": result.get("error"),
                "commitSha": sha,
            },
        )
        print(f"completed {trial_id} status={result['status']} score={result.get('score')}")


def main() -> None:
    p = argparse.ArgumentParser(description="Trainfabric GPU runner")
    p.add_argument("--api", default=os.environ.get("TF_API_URL", ""))
    p.add_argument("--token", default=os.environ.get("RUNNER_TOKEN", ""))
    p.add_argument("--poll", type=float, default=float(os.environ.get("POLL_SEC", "10")))
    p.add_argument("--workdir", default=os.environ.get("WORKDIR", "/tmp/tf-runner"))
    args = p.parse_args()
    if not args.api or not args.token:
        raise SystemExit("--api and --token (or TF_API_URL / RUNNER_TOKEN) required")
    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    print(f"gpu-runner polling {args.api}")
    claim_loop(args.api, args.token, args.poll, workdir)


if __name__ == "__main__":
    main()
