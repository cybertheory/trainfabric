#!/usr/bin/env python3
"""
Trainfabric autorunner daemon — runs inside a Box sandbox.

Goal-first loop: bind a dataset the agent discovers (if none was given) →
pull repo → propose (optional /prompt) → enqueue GPU trial → await score →
keep/revert → report progress / social findings. Reads steer messages the user
or an external agent sends via /auto/:id/messages.

Env:
  AUTORUN_ID, TF_API_URL, TF_TOKEN, TF_DATASET_ID (optional),
  AUTORUN_GOAL (goal-first), PROTOCOL_JSON, REPO_URL, REPO_BRANCH, COMPUTE_PROVIDER
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

REPO_DIR = Path(os.environ.get("REPO_DIR", os.path.expanduser("~/repo")))
POLL_SEC = float(os.environ.get("AUTORUN_POLL_SEC", "15"))
MAX_IDLE_LOOPS = int(os.environ.get("AUTORUN_MAX_IDLE", "4"))


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def api(method: str, path: str, body: Optional[dict] = None) -> Any:
    base = env("TF_API_URL").rstrip("/")
    url = f"{base}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {env('TF_TOKEN')}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> {e.code}: {err}") from e


def sh(cmd: str, cwd: Optional[Path] = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        shell=True,
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=True,
        check=check,
    )


def ensure_repo() -> None:
    url = env("REPO_URL")
    branch = env("REPO_BRANCH", "main")
    if not url:
        raise RuntimeError("REPO_URL required")
    if not REPO_DIR.exists():
        REPO_DIR.parent.mkdir(parents=True, exist_ok=True)
        sh(f"git clone --branch {branch} --single-branch {url} {REPO_DIR}")
    else:
        sh("git fetch origin", cwd=REPO_DIR, check=False)
        sh(f"git checkout {branch}", cwd=REPO_DIR, check=False)
        sh(f"git pull --ff-only origin {branch}", cwd=REPO_DIR, check=False)


def load_protocol() -> dict[str, Any]:
    raw = env("PROTOCOL_JSON")
    if not raw:
        raise RuntimeError("PROTOCOL_JSON required")
    return json.loads(raw)


def assert_immutable(protocol: dict[str, Any]) -> None:
    """Refuse to continue if immutable paths were modified vs HEAD~0 baseline."""
    for path in protocol.get("immutablePaths") or []:
        # Touch check — agent must not stage edits here
        st = sh(f"git status --porcelain -- {path}", cwd=REPO_DIR, check=False)
        if st.stdout.strip():
            raise RuntimeError(f"immutable path dirty: {path}")


def propose_via_prompt(dataset_id: str, hypothesis_hint: str) -> Optional[str]:
    """Optional lakehouse propose step — Hermes /prompt for data insight."""
    try:
        out = api(
            "POST",
            f"/datasets/{dataset_id}/prompt",
            {
                "prompt": hypothesis_hint,
                "execute": True,
                "snapshot": load_protocol().get("snapshotId"),
            },
        )
        return str(out.get("explanation") or out.get("filter") or "")[:500]
    except Exception as e:  # noqa: BLE001
        print(f"prompt skipped: {e}", file=sys.stderr)
        return None


def discover_and_bind(auto_run_id: str, goal: str) -> Optional[str]:
    """Goal-first: search the lakehouse for a dataset and bind it to the run."""
    if not goal:
        return None
    try:
        listing = api("GET", f"/datasets?search={urllib.parse.quote(goal)}")
        datasets = listing.get("datasets") or []
    except Exception as e:  # noqa: BLE001
        print(f"discover failed: {e}", file=sys.stderr)
        return None
    if not datasets:
        print("discover: no dataset candidates", file=sys.stderr)
        return None
    top = datasets[0]
    dataset_id = top.get("id")
    if not dataset_id:
        return None
    try:
        api(
            "POST",
            f"/auto/{auto_run_id}/bind-dataset",
            {
                "datasetId": dataset_id,
                "reason": f"Top discovery match for goal: {goal[:160]}",
            },
        )
        send_message(auto_run_id, f"Bound dataset {dataset_id} for goal: {goal[:120]}")
        return dataset_id
    except Exception as e:  # noqa: BLE001
        print(f"bind failed: {e}", file=sys.stderr)
        return None


def send_message(auto_run_id: str, content: str) -> None:
    """Post an assistant-side message so the shared thread reflects agent activity."""
    try:
        api(
            "POST",
            f"/auto/{auto_run_id}/messages",
            {"content": content, "role": "assistant", "source": "daemon"},
        )
    except Exception as e:  # noqa: BLE001
        print(f"message skipped: {e}", file=sys.stderr)


def read_steer() -> list[str]:
    """Drain steer instructions dropped by the router into the inbox."""
    inbox = Path.home() / "trainfabric" / "inbox" / "steer.log"
    if not inbox.exists():
        return []
    try:
        lines = [ln.strip() for ln in inbox.read_text().splitlines() if ln.strip()]
        inbox.write_text("")
        return lines
    except Exception:  # noqa: BLE001
        return []


def git_sha() -> str:
    return sh("git rev-parse HEAD", cwd=REPO_DIR).stdout.strip()


def enqueue_trial(auto_run_id: str, hypothesis: str, sha: str) -> dict[str, Any]:
    return api(
        "POST",
        f"/auto/{auto_run_id}/trials",
        {"hypothesis": hypothesis, "commitSha": sha},
    )


def wait_trial(auto_run_id: str, trial_id: str, timeout_sec: int) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        detail = api("GET", f"/auto/{auto_run_id}")
        for t in detail.get("trials") or []:
            if t.get("id") == trial_id and t.get("status") in ("done", "error", "cancelled"):
                return t
        time.sleep(POLL_SEC)
    return {"id": trial_id, "status": "error", "error": "timeout waiting for GPU trial"}


def ratchet(kept: bool, sha_before: str) -> None:
    if kept:
        sh("git push origin HEAD", cwd=REPO_DIR, check=False)
        return
    sh(f"git reset --hard {sha_before}", cwd=REPO_DIR, check=False)


def post_finding(dataset_id: str, body: str, findings: dict[str, Any]) -> None:
    try:
        api(
            "POST",
            "/social/posts",
            {
                "datasetId": dataset_id,
                "body": body,
                "source": "agent",
                "authorName": "autoresearch",
                "findings": findings,
            },
        )
    except Exception as e:  # noqa: BLE001
        print(f"social post skipped: {e}", file=sys.stderr)


def run_loop() -> None:
    auto_run_id = env("AUTORUN_ID")
    dataset_id = env("TF_DATASET_ID")
    goal = env("AUTORUN_GOAL")
    if not auto_run_id:
        raise RuntimeError("AUTORUN_ID required")

    # Goal-first: if no dataset was pre-bound, discover + bind one.
    if not dataset_id:
        send_message(auto_run_id, f"Discovering datasets for goal: {goal or '(unspecified)'}")
        dataset_id = discover_and_bind(auto_run_id, goal) or ""
    if not dataset_id:
        send_message(
            auto_run_id,
            "No dataset match found — awaiting a dataset bind from the user. "
            "Reply here or bind one in the monitor to continue.",
        )
        # Wait for a human/agent to bind via /auto/:id/bind-dataset.
        for _ in range(MAX_IDLE_LOOPS * 4):
            detail = api("GET", f"/auto/{auto_run_id}")
            run = detail.get("run") or {}
            if run.get("status") in ("cancelled", "done", "error"):
                return
            if run.get("datasetId"):
                dataset_id = run["datasetId"]
                break
            time.sleep(POLL_SEC)
    if not dataset_id:
        raise RuntimeError("no dataset bound; exiting")

    protocol = load_protocol()
    ensure_repo()
    assert_immutable(protocol)

    budget = protocol.get("budget") or {}
    max_trials = int(budget.get("maxTrials") or 10)
    wall = int(budget.get("maxWallClockSec") or 3600)
    metric = protocol.get("metric") or {}
    direction = metric.get("direction") or "min"

    started = time.time()
    idle = 0
    trial_n = 0

    while trial_n < max_trials and (time.time() - started) < wall:
        detail = api("GET", f"/auto/{auto_run_id}")
        run = detail.get("run") or {}
        status = run.get("status")
        if status in ("paused", "cancelled", "done", "error"):
            print(f"run status={status}; exiting")
            break

        steer = read_steer()
        if steer:
            send_message(
                auto_run_id,
                f"Acknowledged {len(steer)} instruction(s); factoring into the next trial.",
            )

        sha_before = git_sha()
        hypothesis = (
            f"Autoresearch trial {trial_n + 1}: improve {metric.get('name')} "
            f"({direction}) within mutable paths {protocol.get('mutablePaths')}"
        )
        if steer:
            hypothesis = f"{hypothesis} | steer: {' '.join(steer)[:200]}"
        insight = propose_via_prompt(dataset_id, hypothesis)
        if insight:
            hypothesis = f"{hypothesis} | data: {insight[:200]}"

        # Lightweight local mutate signal — real agents edit mutablePaths via Box prompt/CLI
        mutable = (protocol.get("mutablePaths") or ["train.py"])[0]
        note = REPO_DIR / mutable
        if note.exists():
            with note.open("a", encoding="utf-8") as f:
                f.write(f"\n# autorunner touch trial={trial_n + 1} t={int(time.time())}\n")
            sh(f'git add {mutable} && git commit -m "auto: trial {trial_n + 1}" --allow-empty', cwd=REPO_DIR, check=False)

        assert_immutable(protocol)
        sha = git_sha()
        trial = enqueue_trial(auto_run_id, hypothesis, sha)
        trial_id = trial.get("id")
        if not trial_id:
            idle += 1
            if idle >= MAX_IDLE_LOOPS:
                break
            time.sleep(POLL_SEC)
            continue

        result = wait_trial(auto_run_id, trial_id, min(wall, int(budget.get("maxGpuSec") or wall)))
        kept = bool(result.get("kept"))
        ratchet(kept, sha_before)
        trial_n += 1
        idle = 0

        post_finding(
            dataset_id,
            f"Trial {trial_n}: score={result.get('score')} kept={kept} sha={result.get('commitSha') or sha}",
            {
                "trialId": trial_id,
                "score": result.get("score"),
                "kept": kept,
                "metric": metric,
            },
        )

    print(f"daemon finished trials={trial_n}")


if __name__ == "__main__":
    try:
        run_loop()
    except Exception as e:  # noqa: BLE001
        print(f"fatal: {e}", file=sys.stderr)
        sys.exit(1)
