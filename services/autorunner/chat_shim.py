#!/usr/bin/env python3
"""
Box chat shim on :8787.

Always installed at provision so the Worker can reach THIS sandbox's /chat
even if the autorunner template is stale. Queues steers into the daemon inbox
and returns a Hermes (CF AI Gateway) reply when configured.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("AUTORUN_CHAT_PORT", "8787"))
HOME = Path.home() / "trainfabric"

# Prefer ~/trainfabric copy (soft-refreshed), then this file's directory.
for p in (str(HOME), str(Path(__file__).resolve().parent)):
    if p not in sys.path:
        sys.path.insert(0, p)


def _load_chat_reply():
    try:
        import chat_reply  # type: ignore

        return chat_reply
    except ImportError:
        return None


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
        cr = _load_chat_reply()
        st = cr.read_status() if cr else {"phase": "running", "trial": 0}
        if path in ("/health", "/", "/status"):
            self._json(
                200,
                {
                    "ok": True,
                    "autoRunId": os.environ.get("AUTORUN_ID", ""),
                    "phase": st.get("phase"),
                    "trial": st.get("trial"),
                    "hermes": bool(cr),
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

        cr = _load_chat_reply()
        if cr is not None:
            out = cr.handle_chat(content)
            code = 200 if out.get("ok") else 400
            self._json(code, out)
            return

        # Absolute fallback if chat_reply.py missing from the image.
        HOME.mkdir(parents=True, exist_ok=True)
        inbox = HOME / "inbox" / "steer.log"
        inbox.parent.mkdir(parents=True, exist_ok=True)
        with inbox.open("a", encoding="utf-8") as f:
            f.write(content.replace("\n", " ") + "\n")
        self._json(
            200,
            {
                "ok": True,
                "reply": (
                    f"Queued on Box (Hermes chat_reply unavailable). Instruction: {content[:240]}"
                ),
                "queued": True,
            },
        )


def main() -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"chat_shim listening on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
