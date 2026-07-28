#!/usr/bin/env python3
"""
Trainfabric autorunner daemon — runs inside a Box sandbox.

Repo-first loop: clone the bound GitHub repo → load goal/instructions from
TRAINFABRIC.md / AGENTS.md / README.md → discover + bind a dataset (if none
was given) → mutate via Cloudflare AI Gateway (Hermes-parity agent_mutate) →
enqueue GPU trial → await score → keep/revert → report progress / social
findings. Steer messages arrive via /auto/:id/messages.

Env:
  AUTORUN_ID, TF_API_URL, TF_TOKEN, TF_DATASET_ID (optional),
  AUTORUN_GOAL (optional override; otherwise loaded from the repo),
  PROTOCOL_JSON, REPO_URL, REPO_BRANCH, COMPUTE_PROVIDER,
  GITHUB_TOKEN (optional App installation token), REPO_FULL_NAME,
  CF_ACCOUNT_ID, CF_AI_GATEWAY_TOKEN, CF_AI_GATEWAY_ID, CF_AI_GATEWAY_BASE,
  CF_AI_MODEL (Cloudflare AI Gateway — same as Hermes compute)
"""

from __future__ import annotations

import json
import os
import re
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
    # Cloudflare Bot Fight (1010) bans Python-urllib's default UA from Box sandboxes.
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {env('TF_TOKEN')}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 TrainfabricAutorunner/1.0"
            ),
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


def _repo_full_name() -> str:
    full = env("REPO_FULL_NAME")
    if full:
        return full.replace(".git", "")
    url = env("REPO_URL")
    return (
        url.replace("https://github.com/", "")
        .replace("https://www.github.com/", "")
        .replace(".git", "")
        .strip("/")
    )


def _clone_url(token: str = "") -> str:
    full = _repo_full_name()
    tok = token or env("GITHUB_TOKEN")
    if tok and full and "/" in full:
        return f"https://x-access-token:{tok}@github.com/{full}.git"
    url = env("REPO_URL")
    if not url:
        raise RuntimeError("REPO_URL required")
    return url


def refresh_github_token() -> str:
    """Re-mint installation token via control plane (campaign auth)."""
    auto_run_id = env("AUTORUN_ID")
    if not auto_run_id:
        return env("GITHUB_TOKEN")
    try:
        out = api("POST", f"/auto/{auto_run_id}/github-credentials", {})
        tok = str(out.get("token") or "")
        if tok:
            os.environ["GITHUB_TOKEN"] = tok
        return tok or env("GITHUB_TOKEN")
    except Exception as e:  # noqa: BLE001
        print(f"github token refresh skipped: {e}", file=sys.stderr)
        return env("GITHUB_TOKEN")


def ensure_repo() -> None:
    branch = env("REPO_BRANCH", "main")
    url = _clone_url()
    if not REPO_DIR.exists():
        REPO_DIR.parent.mkdir(parents=True, exist_ok=True)
        clone = sh(f"git clone --branch {branch} --single-branch {url} {REPO_DIR}", check=False)
        if clone.returncode != 0:
            tok = refresh_github_token()
            url = _clone_url(tok)
            sh(f"git clone --branch {branch} --single-branch {url} {REPO_DIR}")
        sh('git config user.email "bot@trainfabric.local"', cwd=REPO_DIR, check=False)
        sh('git config user.name "trainfabric-bot"', cwd=REPO_DIR, check=False)
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
    if env("AUTORUN_SKIP_PROMPT", "0") in ("1", "true", "yes"):
        return None
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


def _search_queries(goal: str) -> list[str]:
    """Build a few lakehouse search strings from the repo brief."""
    queries: list[str] = []
    for line in goal.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if len(stripped) >= 8:
            queries.append(stripped[:240])
            break
    # Keyword bag for broader recall (taxi, nyc, …).
    tokens = [
        t.lower()
        for t in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", goal)
        if t.lower()
        not in {
            "the",
            "and",
            "for",
            "with",
            "from",
            "this",
            "that",
            "into",
            "using",
            "train",
            "model",
            "metric",
            "improve",
            "dataset",
            "data",
        }
    ]
    if tokens:
        queries.append(" ".join(tokens[:8])[:240])
    if goal.strip() and goal.strip()[:240] not in queries:
        queries.append(goal.strip()[:240])
    # Dedupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        key = q.lower()
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out[:4]


def _score_dataset(ds: dict[str, Any], query: str) -> float:
    name = str(ds.get("name") or "").lower()
    owner = str(ds.get("owner") or "").lower()
    desc = str(ds.get("description") or "").lower()
    q = query.lower()
    score = 0.0
    if name and name in q:
        score += 5.0
    for tok in q.split():
        if len(tok) < 3:
            continue
        if tok in name:
            score += 2.0
        elif tok in desc:
            score += 1.0
        elif tok in owner:
            score += 0.5
    rows = ds.get("rowCount") or ds.get("rows") or 0
    try:
        if int(rows) > 0:
            score += 1.0
    except (TypeError, ValueError):
        pass
    return score


def search_datasets(goal: str) -> list[dict[str, Any]]:
    """Search Trainfabric datasets for the repo brief; ranked unique list."""
    by_id: dict[str, dict[str, Any]] = {}
    scores: dict[str, float] = {}
    for query in _search_queries(goal) or ["dataset"]:
        try:
            listing = api("GET", f"/datasets?search={urllib.parse.quote(query)}&limit=20")
            for ds in listing.get("datasets") or []:
                did = ds.get("id")
                if not did:
                    continue
                by_id[did] = ds
                scores[did] = max(scores.get(did, 0.0), _score_dataset(ds, query))
        except Exception as e:  # noqa: BLE001
            print(f"discover search failed ({query[:40]}): {e}", file=sys.stderr)
    ranked = sorted(by_id.values(), key=lambda d: scores.get(d.get("id") or "", 0.0), reverse=True)
    for d in ranked:
        d["_tf_score"] = scores.get(d.get("id") or "", 0.0)
    return ranked


def bind_dataset_id(auto_run_id: str, dataset_id: str, reason: str) -> Optional[str]:
    try:
        api(
            "POST",
            f"/auto/{auto_run_id}/bind-dataset",
            {"datasetId": dataset_id, "reason": reason[:500]},
        )
        send_message(auto_run_id, f"Bound dataset `{dataset_id}` — {reason[:240]}")
        return dataset_id
    except Exception as e:  # noqa: BLE001
        print(f"bind failed: {e}", file=sys.stderr)
        send_message(auto_run_id, f"Could not bind `{dataset_id}`: {e}")
        return None


def discover_and_bind(auto_run_id: str, goal: str, source: str = "repo") -> Optional[str]:
    """Search the lakehouse and auto-bind when there is a clear top match."""
    if not goal:
        return None
    # Explicit ids in the brief win (e.g. `ds_…` in TRAINFABRIC.md).
    explicit = _extract_dataset_id(goal)
    if explicit:
        return bind_dataset_id(
            auto_run_id,
            explicit,
            f"Bound dataset id cited in repo brief ({source})",
        )
    ranked = search_datasets(goal)
    if not ranked:
        print("discover: no dataset candidates", file=sys.stderr)
        return None
    top = ranked[0]
    top_score = float(top.get("_tf_score") or 0)
    second = float(ranked[1].get("_tf_score") or 0) if len(ranked) > 1 else 0.0
    dataset_id = top.get("id")
    if not dataset_id:
        return None
    # Auto-bind when clearly best (sole hit, or score gap / strong match).
    clear = len(ranked) == 1 or top_score >= 4.0 or (top_score >= 2.0 and top_score >= second + 1.5)
    if not clear:
        print(
            f"discover: ambiguous top={dataset_id} score={top_score} second={second}",
            file=sys.stderr,
        )
        return None
    return bind_dataset_id(
        auto_run_id,
        str(dataset_id),
        f"Auto-chose top discovery match for repo brief ({source}): "
        f"{top.get('owner')}/{top.get('name')} (score={top_score:.1f})",
    )


def _extract_dataset_id(text: str) -> Optional[str]:
    m = re.search(r"\b(ds_[a-f0-9]{8,})\b", text, re.I)
    return m.group(1) if m else None


def resolve_dataset_from_steer(
    auto_run_id: str, text: str, candidates: list[dict[str, Any]]
) -> Optional[str]:
    """Parse a chat/MCP steer into a dataset bind (id, name, or 'use #N' / first)."""
    raw = text.strip()
    if not raw:
        return None
    lower = raw.lower()

    did = _extract_dataset_id(raw)
    if did:
        return bind_dataset_id(auto_run_id, did, f"Bound from chat steer: {raw[:160]}")

    # "use the first" / "bind 1" / "pick #2"
    if re.search(r"\b(first|top|any|auto|you choose|pick one)\b", lower) and candidates:
        c = candidates[0]
        return bind_dataset_id(
            auto_run_id,
            str(c["id"]),
            f"Chat asked to use top candidate: {c.get('name')}",
        )
    m = re.search(r"(?:#|number|option|candidate)\s*(\d+)", lower)
    if m and candidates:
        idx = int(m.group(1)) - 1
        if 0 <= idx < len(candidates):
            c = candidates[idx]
            return bind_dataset_id(
                auto_run_id,
                str(c["id"]),
                f"Chat selected candidate #{idx + 1}: {c.get('name')}",
            )

    # Name / owner substring match against candidates or fresh search
    needle = lower
    for prefix in ("use ", "bind ", "try ", "dataset ", "pick ", "choose "):
        if needle.startswith(prefix):
            needle = needle[len(prefix) :].strip()
    pool = candidates or search_datasets(raw)
    for c in pool:
        name = str(c.get("name") or "").lower()
        owner = str(c.get("owner") or "").lower()
        label = f"{owner}/{name}"
        if needle and (needle in name or needle in label or name in needle):
            return bind_dataset_id(
                auto_run_id,
                str(c["id"]),
                f"Matched chat name `{needle}` → {label}",
            )

    # Broader search from the steer text itself
    if len(raw) >= 3:
        found = search_datasets(raw)
        if len(found) == 1 or (found and float(found[0].get("_tf_score") or 0) >= 3):
            return bind_dataset_id(
                auto_run_id,
                str(found[0]["id"]),
                f"Searched Trainfabric for chat text: {raw[:120]}",
            )
    return None


def await_dataset_via_chat(auto_run_id: str, goal: str, source: str) -> Optional[str]:
    """
    Pause for a chat/MCP decision when auto-discovery is unclear.
    Keeps listening for steers and for binds done via MCP/CLI bind_auto_dataset.
    """
    candidates = search_datasets(goal)
    lines = []
    for i, c in enumerate(candidates[:8], start=1):
        lines.append(
            f"{i}. `{c.get('id')}` — {c.get('owner')}/{c.get('name')} "
            f"(rows={c.get('rowCount') or c.get('rows') or '?'}, score={c.get('_tf_score', 0):.1f})"
        )
    catalog = "\n".join(lines) if lines else "(no search hits yet)"
    send_message(
        auto_run_id,
        "I couldn't confidently pick a dataset from the repo brief "
        f"({source}). Candidates from Trainfabric:\n{catalog}\n\n"
        "Reply here with a dataset id (`ds_…`), a name, or e.g. `use the first`. "
        "MCP/CLI can also call `bind_auto_dataset` / `tf auto bind`. "
        "I'll pause until you answer.",
    )
    heartbeat(
        auto_run_id,
        "awaiting_user",
        0,
        "Paused — waiting for dataset choice in chat (or MCP bind)",
    )

    # Long wait: chat-driven; also honor remote bind.
    max_loops = max(MAX_IDLE_LOOPS * 40, 80)  # ~20+ min at default poll
    for _ in range(max_loops):
        detail = api("GET", f"/auto/{auto_run_id}")
        run = detail.get("run") or {}
        if run.get("status") in ("cancelled", "done", "error"):
            return None
        if run.get("datasetId"):
            send_message(auto_run_id, f"Dataset already bound (`{run['datasetId']}`) — continuing.")
            return str(run["datasetId"])

        steer = read_steer()
        for msg in steer:
            if re.search(r"\b(search|find|look)\b", msg, re.I):
                extra = search_datasets(msg)
                if extra:
                    candidates = extra
                    preview = ", ".join(
                        f"{c.get('name')}(`{c.get('id')}`)" for c in extra[:5]
                    )
                    send_message(auto_run_id, f"New search hits: {preview}")
            bound = resolve_dataset_from_steer(auto_run_id, msg, candidates)
            if bound:
                heartbeat(auto_run_id, "running", 0, "Dataset chosen — resuming")
                return bound
            send_message(
                auto_run_id,
                f"Got your note ({msg[:200]}) but couldn't resolve a dataset yet. "
                "Send an id like `ds_…`, a dataset name, or `use the first`.",
            )

        heartbeat(auto_run_id, "awaiting_user", 0)
        time.sleep(POLL_SEC)
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

    try:
        import chat_reply  # type: ignore
    except ImportError:
        sys.path.insert(0, str(Path.home() / "trainfabric"))
        try:
            import chat_reply  # type: ignore
        except ImportError:
            chat_reply = None  # type: ignore

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
                        "hermes": chat_reply is not None,
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
            if chat_reply is not None:
                out = chat_reply.handle_chat(
                    content,
                    in_memory_steer=_STEER,
                    status_override=_STATE,
                )
                self._json(200 if out.get("ok") else 400, out)
                return
            _STEER.append(content)
            phase = _STATE.get("phase") or "running"
            trial = _STATE.get("trial") or 0
            self._json(
                200,
                {
                    "ok": True,
                    "reply": (
                        f"Got it — queued for the next loop. "
                        f"I'm currently {phase} (trial {trial}). "
                        f"Instruction: {content[:240]}"
                    ),
                    "queued": True,
                    "phase": phase,
                    "trial": trial,
                },
            )

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


def _push_origin() -> None:
    push = sh("git push origin HEAD", cwd=REPO_DIR, check=False)
    if push.returncode != 0 and env("GITHUB_INSTALLATION_ID"):
        tok = refresh_github_token()
        full = _repo_full_name()
        if tok and full:
            remote = f"https://x-access-token:{tok}@github.com/{full}.git"
            sh(f"git remote set-url origin {remote}", cwd=REPO_DIR, check=False)
            sh("git push origin HEAD", cwd=REPO_DIR, check=False)


def ratchet(kept: bool, sha_before: str) -> None:
    if kept:
        _push_origin()
        return
    sh(f"git reset --hard {sha_before}", cwd=REPO_DIR, check=False)


def _snapshot_viz() -> dict[str, bytes]:
    root = REPO_DIR / "artifacts" / "viz"
    if not root.is_dir():
        return {}
    out: dict[str, bytes] = {}
    for path in root.rglob("*"):
        if path.is_file():
            rel = str(path.relative_to(REPO_DIR))
            try:
                out[rel] = path.read_bytes()
            except OSError:
                continue
    return out


def republish_viz_after_revert(blobs: dict[str, bytes]) -> None:
    """Keep artifacts/viz on GitHub even when the trial code is discarded."""
    if not blobs:
        return
    for rel, data in blobs.items():
        path = REPO_DIR / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    quoted = " ".join(f"'{r}'" for r in blobs)
    sh(f"git add {quoted}", cwd=REPO_DIR, check=False)
    commit = sh(
        'git commit -m "auto: publish viz (trial reverted)"',
        cwd=REPO_DIR,
        check=False,
    )
    if commit.returncode == 0:
        _push_origin()


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
    # If ambiguous / empty: ask in chat, set awaiting_user, wait for steer or MCP bind.
    if not dataset_id:
        heartbeat(auto_run_id, "discovering", 0, "Discovering datasets from repo brief")
        dataset_id = discover_and_bind(auto_run_id, goal, goal_source) or ""
    if not dataset_id:
        dataset_id = await_dataset_via_chat(auto_run_id, goal, goal_source) or ""
    if not dataset_id:
        send_message(
            auto_run_id,
            "Still no dataset after waiting — exiting. Start a new run or bind via MCP "
            "`bind_auto_dataset` / CLI and message me again.",
        )
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

        # Hermes-parity mutate via Cloudflare AI Gateway (+ viz under artifacts/viz/)
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            sys.path.insert(0, str(Path.home() / "trainfabric"))
            import importlib
            import agent_mutate  # type: ignore

            agent_mutate = importlib.reload(agent_mutate)
            propose_mutate = agent_mutate.propose_mutate
        except ImportError:
            propose_mutate = None  # type: ignore

        mutate_result: dict[str, Any] = {}
        if propose_mutate is not None:
            mutate_result = propose_mutate(
                repo_dir=REPO_DIR,
                protocol=protocol,
                hypothesis=hypothesis,
                trial_n=trial_n,
                goal=goal,
                steer=steer,
                instructions=goal,
            )
            if mutate_result.get("hypothesis"):
                hypothesis = str(mutate_result["hypothesis"])
            summary = str(mutate_result.get("summary") or "")[:400]
            via = mutate_result.get("via") or "unknown"
            gw_err = mutate_result.get("gateway_error")
            msg = f"Mutate ({via}): {summary or mutate_result.get('files_touched')}"
            if gw_err:
                msg = f"{msg} [{str(gw_err)[:180]}]"
            send_message(auto_run_id, msg)
        else:
            mutable = (protocol.get("mutablePaths") or ["train.py"])[0]
            note = REPO_DIR / mutable
            if note.exists():
                with note.open("a", encoding="utf-8") as f:
                    f.write(
                        f"\n# autorunner touch trial={trial_n + 1} t={int(time.time())}\n"
                    )
                sh(f"git add {mutable}", cwd=REPO_DIR, check=False)

        sh(
            f'git commit -m "auto: trial {trial_n + 1}" --allow-empty',
            cwd=REPO_DIR,
            check=False,
        )

        assert_immutable(protocol)
        sha = git_sha()
        viz_blobs = _snapshot_viz()
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
        if not kept:
            republish_viz_after_revert(viz_blobs)
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
