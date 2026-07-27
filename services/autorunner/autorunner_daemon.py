#!/usr/bin/env python3
"""
Trainfabric autorunner daemon — runs inside a Box sandbox.

Repo-first loop: clone the bound GitHub repo → load goal/instructions from
TRAINFABRIC.md / AGENTS.md / README.md → discover + bind a dataset (if none
was given) → propose (optional /prompt) → enqueue GPU trial → await score →
keep/revert → report progress / social findings. Steer messages arrive via
/auto/:id/messages.

Env:
  AUTORUN_ID, TF_API_URL, TF_TOKEN, TF_DATASET_ID (optional),
  AUTORUN_GOAL (optional override; otherwise loaded from the repo),
  PROTOCOL_JSON, REPO_URL, REPO_BRANCH, COMPUTE_PROVIDER
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
CHAT_PORT = int(os.environ.get("AUTORUN_CHAT_PORT", "8787"))

# In-process steer queue + status for the hosted /chat endpoint.
_STEER: list[str] = []
_STATE: dict[str, Any] = {"phase": "starting", "trial": 0, "ok": True}


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


INSTRUCTION_FILES = (
    "TRAINFABRIC.md",
    "AGENTS.md",
    "AGENT.md",
    "README.md",
    "readme.md",
)


def load_repo_instructions(override: str = "") -> tuple[str, str]:
    """
    Load the research brief from the cloned repo.
    Prefer TRAINFABRIC.md → AGENTS.md → README.md. Optional env override wins.
    Returns (goal_text, source_label).
    """
    if override.strip():
        return override.strip(), "AUTORUN_GOAL"
    for name in INSTRUCTION_FILES:
        path = REPO_DIR / name
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue
        if not text:
            continue
        # Use a compact brief for discovery search; keep enough for hypotheses.
        return text[:4000], name
    # Fall back to repo remote URL fragment so discovery still has a query.
    url = env("REPO_URL")
    short = url.rstrip("/").split("/")[-1].removesuffix(".git") if url else ""
    return (short or "autoresearch", "repo-name")


def report_instructions(auto_run_id: str, goal: str, source: str) -> None:
    """Persist the repo-derived brief on the AutoRun so the monitor can show it."""
    try:
        api(
            "POST",
            f"/auto/{auto_run_id}/instructions",
            {"content": goal[:4000], "sourceFile": source},
        )
    except Exception as e:  # noqa: BLE001
        print(f"instructions report skipped: {e}", file=sys.stderr)
        send_message(
            auto_run_id,
            f"Loaded instructions from {source}:\n\n{goal[:1200]}",
        )


def discover_and_bind(auto_run_id: str, goal: str, source: str = "repo") -> Optional[str]:
    """Repo-brief discovery: search the lakehouse and bind the top match."""
    if not goal:
        return None
    # Prefer the first meaningful line / heading as the search query.
    query = goal
    for line in goal.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if len(stripped) >= 8:
            query = stripped
            break
    query = query[:240]
    try:
        listing = api("GET", f"/datasets?search={urllib.parse.quote(query)}")
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
                "reason": f"Top discovery match for repo brief ({source}): {query[:160]}",
            },
        )
        send_message(auto_run_id, f"Bound dataset {dataset_id} from repo brief ({source})")
        return dataset_id
    except Exception as e:  # noqa: BLE001
        print(f"bind failed: {e}", file=sys.stderr)
        return None


def send_message(auto_run_id: str, content: str) -> None:
    """Post an assistant-side message so the shared thread reflects agent talk-back."""
    try:
        api(
            "POST",
            f"/auto/{auto_run_id}/messages",
            {"content": content, "role": "assistant", "source": "daemon"},
        )
    except Exception as e:  # noqa: BLE001
        print(f"message skipped: {e}", file=sys.stderr)


def heartbeat(auto_run_id: str, phase: str, trial: int = 0, message: str | None = None) -> None:
    """Volunteer liveness to the control plane (API does not cron-poll sandboxes)."""
    _STATE["phase"] = phase
    _STATE["trial"] = trial
    # Local status file for chat_shim /health and /chat replies.
    try:
        status_path = Path.home() / "trainfabric" / "status.json"
        status_path.parent.mkdir(parents=True, exist_ok=True)
        status_path.write_text(
            json.dumps({"phase": phase, "trial": trial, "autoRunId": auto_run_id}),
            encoding="utf-8",
        )
    except Exception:  # noqa: BLE001
        pass
    try:
        body: dict[str, Any] = {"phase": phase, "trial": trial}
        if message:
            body["message"] = message
        api("POST", f"/auto/{auto_run_id}/heartbeat", body)
    except Exception as e:  # noqa: BLE001
        print(f"heartbeat skipped: {e}", file=sys.stderr)


def read_steer() -> list[str]:
    """Drain steer from /chat queue and file inbox dropped by the router."""
    out: list[str] = []
    if _STEER:
        out.extend(_STEER)
        _STEER.clear()
    inbox = Path.home() / "trainfabric" / "inbox" / "steer.log"
    if not inbox.exists():
        return out
    try:
        lines = [ln.strip() for ln in inbox.read_text().splitlines() if ln.strip()]
        inbox.write_text("")
        out.extend(lines)
    except Exception:  # noqa: BLE001
        pass
    return out


def start_chat_server() -> None:
    """HTTP :8787 — skip if chat_shim (or another process) already owns the port."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    import threading

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
            print(f"chat: {fmt % args}", file=sys.stderr)

        def _json(self, code: int, body: dict[str, Any]) -> None:
            raw = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            if path in ("/health", "/", "/status"):
                self._json(
                    200,
                    {
                        "ok": True,
                        "autoRunId": env("AUTORUN_ID"),
                        "phase": _STATE.get("phase"),
                        "trial": _STATE.get("trial"),
                    },
                )
                return
            self._json(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                body = {}
            if path != "/chat":
                self._json(404, {"error": "not found"})
                return
            content = str(body.get("content") or "").strip()
            if not content:
                self._json(400, {"error": "content required"})
                return
            _STEER.append(content)
            phase = _STATE.get("phase") or "running"
            trial = _STATE.get("trial") or 0
            reply = (
                f"Got it — queued for the next loop. "
                f"I'm currently {phase} (trial {trial}). "
                f"Instruction: {content[:240]}"
            )
            self._json(200, {"ok": True, "reply": reply, "queued": True})

    try:
        server = ThreadingHTTPServer(("0.0.0.0", CHAT_PORT), Handler)
    except OSError as e:
        print(f"chat server not started (port {CHAT_PORT} in use — chat_shim ok): {e}", file=sys.stderr)
        return
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="tf-chat")
    thread.start()
    print(f"chat server listening on :{CHAT_PORT}", file=sys.stderr)


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
    if not auto_run_id:
        raise RuntimeError("AUTORUN_ID required")

    start_chat_server()
    heartbeat(auto_run_id, "starting", 0, "Daemon online — chat server listening")

    protocol = load_protocol()
    # Repo-first: clone, then load goal/instructions from the tree.
    ensure_repo()
    goal, goal_source = load_repo_instructions(env("AUTORUN_GOAL"))
    report_instructions(auto_run_id, goal, goal_source)
    assert_immutable(protocol)
    heartbeat(auto_run_id, "repo_loaded", 0)

    # If no dataset was pre-bound, discover + bind from the repo brief.
    if not dataset_id:
        heartbeat(auto_run_id, "discovering", 0, "Discovering datasets from repo brief")
        dataset_id = discover_and_bind(auto_run_id, goal, goal_source) or ""
    if not dataset_id:
        send_message(
            auto_run_id,
            "No dataset match for the repo brief — awaiting a dataset bind. "
            "Reply here or bind one in the monitor to continue.",
        )
        # Wait for a human/agent to bind via /auto/:id/bind-dataset.
        for _ in range(MAX_IDLE_LOOPS * 4):
            heartbeat(auto_run_id, "awaiting_dataset", 0)
            detail = api("GET", f"/auto/{auto_run_id}")
            run = detail.get("run") or {}
            if run.get("status") in ("cancelled", "done", "error"):
                return
            if run.get("datasetId"):
                dataset_id = run["datasetId"]
                break
            # Apply any chat steers while waiting.
            steer = read_steer()
            if steer:
                send_message(
                    auto_run_id,
                    f"Acknowledged while waiting for dataset: {' '.join(steer)[:300]}",
                )
            time.sleep(POLL_SEC)
    if not dataset_id:
        raise RuntimeError("no dataset bound; exiting")

    budget = protocol.get("budget") or {}
    max_trials = int(budget.get("maxTrials") or 10)
    wall = int(budget.get("maxWallClockSec") or 3600)
    metric = protocol.get("metric") or {}
    direction = metric.get("direction") or "min"

    started = time.time()
    idle = 0
    trial_n = 0
    heartbeat(auto_run_id, "running", 0, "Starting trial loop")

    while trial_n < max_trials and (time.time() - started) < wall:
        detail = api("GET", f"/auto/{auto_run_id}")
        run = detail.get("run") or {}
        status = run.get("status")
        if status in ("paused", "cancelled", "done", "error"):
            print(f"run status={status}; exiting")
            heartbeat(auto_run_id, status, trial_n)
            break

        steer = read_steer()
        if steer:
            send_message(
                auto_run_id,
                f"Acknowledged {len(steer)} instruction(s); factoring into the next trial. "
                f"→ {' | '.join(steer)[:400]}",
            )

        sha_before = git_sha()
        hypothesis = (
            f"Autoresearch trial {trial_n + 1}: improve {metric.get('name')} "
            f"({direction}) within mutable paths {protocol.get('mutablePaths')}"
        )
        if goal:
            hypothesis = f"{hypothesis} | brief: {goal[:180]}"
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
        heartbeat(auto_run_id, "enqueueing", trial_n, f"Enqueuing trial {trial_n + 1}")
        trial = enqueue_trial(auto_run_id, hypothesis, sha)
        trial_id = trial.get("id")
        if not trial_id:
            idle += 1
            if idle >= MAX_IDLE_LOOPS:
                break
            time.sleep(POLL_SEC)
            continue

        send_message(
            auto_run_id,
            f"Trial {trial_n + 1} enqueued ({trial_id}) — waiting on GPU compute.",
        )
        heartbeat(auto_run_id, "waiting_gpu", trial_n + 1)
        result = wait_trial(auto_run_id, trial_id, min(wall, int(budget.get("maxGpuSec") or wall)))
        kept = bool(result.get("kept"))
        ratchet(kept, sha_before)
        trial_n += 1
        idle = 0

        send_message(
            auto_run_id,
            f"Trial {trial_n} finished: score={result.get('score')} kept={kept} "
            f"sha={(result.get('commitSha') or sha)[:12]}",
        )
        heartbeat(auto_run_id, "running", trial_n)

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

    heartbeat(auto_run_id, "done", trial_n, f"Daemon finished trials={trial_n}")
    print(f"daemon finished trials={trial_n}")


if __name__ == "__main__":
    try:
        run_loop()
    except Exception as e:  # noqa: BLE001
        print(f"fatal: {e}", file=sys.stderr)
        sys.exit(1)
