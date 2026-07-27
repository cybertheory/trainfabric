#!/usr/bin/env python3
"""
Minimal Box chat shim on :8787.

Always installed at provision so the Worker can reach THIS sandbox's /chat
even if the autorunner template is stale. Queues steers into the daemon inbox
and replies using ~/trainfabric/status.json when the daemon volunteers it.
"""

from __future__ import annotations

import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("AUTORUN_CHAT_PORT", "8787"))
HOME = Path.home() / "trainfabric"
INBOX = HOME / "inbox" / "steer.log"
STATUS = HOME / "status.json"


def read_status() -> dict:
    try:
        if STATUS.exists():
            return json.loads(STATUS.read_text())
    except Exception:  # noqa: BLE001
        pass
    return {"phase": "running", "trial": 0}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        print(f"chat_shim: {fmt % args}", flush=True)

    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path in ("/health", "/", "/status"):
            st = read_status()
            self._json(
                200,
                {
                    "ok": True,
                    "autoRunId": os.environ.get("AUTORUN_ID", ""),
                    "phase": st.get("phase"),
                    "trial": st.get("trial"),
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
        HOME.mkdir(parents=True, exist_ok=True)
        INBOX.parent.mkdir(parents=True, exist_ok=True)
        with INBOX.open("a", encoding="utf-8") as f:
            f.write(content.replace("\n", " ") + "\n")
        st = read_status()
        phase = st.get("phase") or "running"
        trial = st.get("trial") or 0
        reply = (
            f"Received on this Box sandbox. Currently {phase} (trial {trial}). "
            f"Queued for the agent loop. Instruction: {content[:240]}"
        )
        self._json(200, {"ok": True, "reply": reply, "queued": True})


def main() -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"chat_shim listening on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
