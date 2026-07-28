#!/usr/bin/env python3
"""Hermes talk-back for Box /chat — queue steer + immediate CF AI Gateway reply.

Used by chat_shim.py and autorunner_daemon.start_chat_server so Steer messages
get a real agent response through the Trainfabric API in one round-trip.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

HOME = Path(os.environ.get("TRAINFABRIC_HOME", os.path.expanduser("~/trainfabric")))
INBOX = HOME / "inbox" / "steer.log"
STATUS = HOME / "status.json"

# Ensure sibling modules (gateway.py) import when cwd differs.
if str(HOME) not in sys.path:
    sys.path.insert(0, str(HOME))
_here = str(Path(__file__).resolve().parent)
if _here not in sys.path:
    sys.path.insert(0, _here)


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _api(method: str, path: str, body: Optional[dict] = None) -> Any:
    base = _env("TF_API_URL").rstrip("/")
    if not base or not _env("TF_TOKEN"):
        raise RuntimeError("TF_API_URL and TF_TOKEN required")
    url = f"{base}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {_env('TF_TOKEN')}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 TrainfabricChat/1.0"
            ),
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def read_status() -> dict[str, Any]:
    try:
        if STATUS.exists():
            return json.loads(STATUS.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        pass
    return {
        "phase": _env("AUTORUN_PHASE", "running") or "running",
        "trial": 0,
        "autoRunId": _env("AUTORUN_ID"),
    }


def queue_steer(content: str, in_memory: Optional[list[str]] = None) -> None:
    """Append steer for the trial loop (in-process queue and/or file inbox)."""
    text = content.replace("\n", " ").strip()
    if not text:
        return
    if in_memory is not None:
        in_memory.append(text)
        return  # daemon drains _STEER; avoid double-delivery via file
    HOME.mkdir(parents=True, exist_ok=True)
    INBOX.parent.mkdir(parents=True, exist_ok=True)
    with INBOX.open("a", encoding="utf-8") as f:
        f.write(text + "\n")


def _extract_dataset_id(text: str) -> Optional[str]:
    m = re.search(r"\b(ds_[a-f0-9]{8,})\b", text, re.I)
    return m.group(1) if m else None


def try_bind_from_chat(content: str) -> Optional[str]:
    """If unbound and the message names a dataset, bind it immediately."""
    auto_run_id = _env("AUTORUN_ID")
    if not auto_run_id:
        return None
    try:
        detail = _api("GET", f"/auto/{auto_run_id}")
        run = detail.get("run") or detail
        if run.get("datasetId"):
            return None  # already bound
    except Exception:  # noqa: BLE001
        run = {}

    did = _extract_dataset_id(content)
    reason = f"Bound from live chat: {content[:160]}"
    if not did:
        lower = content.lower().strip()
        # "use the first" / pick N needs candidates — quick search from goal/env
        goal = _env("AUTORUN_GOAL") or str(run.get("goal") or "")
        query = goal[:120] or "dataset"
        try:
            listing = _api("GET", f"/datasets?search={urllib.parse.quote(query)}&limit=10")
            candidates = listing.get("datasets") or []
        except Exception:  # noqa: BLE001
            candidates = []
        if re.search(r"\b(first|top|any|you choose|pick one)\b", lower) and candidates:
            did = str(candidates[0].get("id") or "")
            reason = f"Chat asked for top candidate: {candidates[0].get('name')}"
        else:
            m = re.search(r"(?:#|number|option|candidate)\s*(\d+)", lower)
            if m and candidates:
                idx = int(m.group(1)) - 1
                if 0 <= idx < len(candidates):
                    did = str(candidates[idx].get("id") or "")
                    reason = f"Chat selected candidate #{idx + 1}"
            else:
                needle = lower
                for prefix in ("use ", "bind ", "try ", "dataset ", "pick ", "choose "):
                    if needle.startswith(prefix):
                        needle = needle[len(prefix) :].strip()
                for c in candidates:
                    name = str(c.get("name") or "").lower()
                    if needle and (needle in name or name in needle):
                        did = str(c.get("id") or "")
                        reason = f"Matched chat name → {c.get('name')}"
                        break

    if not did:
        return None
    try:
        _api(
            "POST",
            f"/auto/{auto_run_id}/bind-dataset",
            {"datasetId": did, "reason": reason[:500]},
        )
        return did
    except Exception as e:  # noqa: BLE001
        print(f"chat_reply bind failed: {e}", file=sys.stderr)
        return None


def _status_fallback(phase: str, trial: Any, content: str, bound: Optional[str] = None) -> str:
    parts = [
        f"I'm on this Box sandbox — phase `{phase}`, trial {trial}.",
    ]
    if bound:
        parts.append(f"Just bound dataset `{bound}`.")
    ds = _env("TF_DATASET_ID")
    if ds:
        parts.append(f"Dataset `{ds}` is bound.")
    elif not bound:
        parts.append("No dataset bound yet — send a `ds_…` id or say `use the first`.")
    parts.append(f"Queued your steer for the trial loop: {content[:200]}")
    return " ".join(parts)


def hermes_reply(content: str, *, phase: str, trial: Any, bind_note: Optional[str] = None) -> str:
    """Short conversational completion via Cloudflare AI Gateway (Hermes parity)."""
    try:
        from gateway import AIGatewayError, gateway_configured, mockable_chat
    except ImportError:
        return _status_fallback(phase, trial, content, bind_note)

    if not gateway_configured():
        return _status_fallback(phase, trial, content, bind_note)

    goal = (_env("AUTORUN_GOAL") or "")[:1200]
    dataset = _env("TF_DATASET_ID") or "(none)"
    metric = ""
    try:
        protocol = json.loads(_env("PROTOCOL_JSON") or "{}")
        m = protocol.get("metric") or {}
        if m:
            metric = f"{m.get('name')} ({m.get('direction')})"
    except Exception:  # noqa: BLE001
        pass

    system = (
        "You are the Trainfabric autorunner Hermes agent running inside a Box sandbox.\n"
        "Answer briefly and concretely about this AutoRun's status, dataset, and next steps.\n"
        "Do not invent trial scores. If the user wants a code change, acknowledge you will "
        "apply it on the next mutate/trial tick.\n"
        f"AutoRun: {_env('AUTORUN_ID') or 'unknown'}\n"
        f"Phase: {phase} · trial: {trial}\n"
        f"Dataset: {dataset}\n"
        f"Metric: {metric or 'n/a'}\n"
        f"Repo: {_env('REPO_FULL_NAME') or _env('REPO_URL') or 'n/a'}\n"
        f"Goal/brief (excerpt):\n{goal or '(none)'}\n"
    )
    if bind_note:
        system += f"\nJust now: bound dataset `{bind_note}` from the user's message.\n"

    try:
        resp = mockable_chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": content[:4000]},
            ],
            tools=None,
            temperature=0.2,
            timeout=25.0,
        )
        choice = (resp.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        text = str(msg.get("content") or "").strip()
        if text:
            return text[:4000]
    except Exception as e:  # noqa: BLE001
        print(f"chat_reply hermes failed: {e}", file=sys.stderr)
        return _status_fallback(phase, trial, content, bind_note) + f" (Hermes unavailable: {e})"

    return _status_fallback(phase, trial, content, bind_note)


def handle_chat(
    content: str,
    *,
    in_memory_steer: Optional[list[str]] = None,
    status_override: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Queue steer, optional bind-from-chat, Hermes reply.
    Returns JSON body for POST /chat.
    """
    text = (content or "").strip()
    if not text:
        return {"ok": False, "error": "content required"}

    st = status_override or read_status()
    phase = str(st.get("phase") or "running")
    trial = st.get("trial") if st.get("trial") is not None else 0

    queue_steer(text, in_memory=in_memory_steer)
    bound = try_bind_from_chat(text)
    if bound and status_override is not None:
        # Reflect bind in local status for subsequent health checks.
        status_override["phase"] = status_override.get("phase") or "running"
    reply = hermes_reply(text, phase=phase, trial=trial, bind_note=bound)

    return {
        "ok": True,
        "reply": reply,
        "queued": True,
        "phase": phase,
        "trial": trial,
        "boundDatasetId": bound,
        "autoRunId": _env("AUTORUN_ID") or st.get("autoRunId"),
    }
