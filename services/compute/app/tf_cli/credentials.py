"""CLI credential store + device login helpers."""

from __future__ import annotations

import json
import os
import sys
import time
import webbrowser
from pathlib import Path
from typing import Any

import httpx
import typer

DEFAULT_API_URL = "https://trainfabric-router.rishabhspro.workers.dev"


def config_dir() -> Path:
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        return Path(xdg) / "trainfabric"
    return Path.home() / ".config" / "trainfabric"


def credentials_path() -> Path:
    return config_dir() / "credentials.json"


def load_credentials() -> dict[str, Any]:
    path = credentials_path()
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def save_credentials(data: dict[str, Any]) -> None:
    path = credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def resolve_api_url() -> str:
    return (
        os.environ.get("TRAINFABRIC_API_URL")
        or load_credentials().get("api_url")
        or DEFAULT_API_URL
    ).rstrip("/")


def resolve_token() -> str:
    return os.environ.get("TRAINFABRIC_TOKEN") or str(load_credentials().get("access_token") or "")


def device_login(*, open_browser: bool = True) -> dict[str, Any]:
    api = resolve_api_url()
    with httpx.Client(timeout=120.0) as client:
        start = client.post(
            f"{api}/auth/device/code",
            json={"client_name": "tf-cli"},
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        try:
            started = start.json()
        except Exception:
            started = {"error": start.text[:2000]}
        if start.status_code >= 400 or not isinstance(started, dict):
            print(json.dumps(started if isinstance(started, dict) else {"error": started}), file=sys.stderr)
            raise typer.Exit(1)

        user_code = started.get("user_code")
        device_code = started.get("device_code")
        verify_url = started.get("verification_uri_complete") or started.get("verification_uri")
        interval = int(started.get("interval") or 5)
        expires_in = int(started.get("expires_in") or 900)

        print(f"Open: {verify_url}", file=sys.stderr)
        print(f"Code: {user_code}", file=sys.stderr)
        if open_browser and verify_url:
            try:
                webbrowser.open(str(verify_url))
            except Exception:
                pass

        deadline = time.time() + expires_in
        while time.time() < deadline:
            time.sleep(max(interval, 2))
            poll = client.post(
                f"{api}/auth/device/token",
                json={
                    "device_code": device_code,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                },
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            try:
                body = poll.json()
            except Exception:
                continue
            if not isinstance(body, dict):
                continue
            err = body.get("error")
            if poll.status_code < 400 and body.get("access_token"):
                save_credentials(
                    {
                        "api_url": api,
                        "access_token": body["access_token"],
                        "token_type": body.get("token_type") or "api_key",
                        "subject": body.get("subject"),
                        "auth_via": body.get("auth_via") or "api_key",
                    }
                )
                return {
                    "ok": True,
                    "subject": body.get("subject"),
                    "auth_via": body.get("auth_via"),
                    "credentials": str(credentials_path()),
                }
            if err == "authorization_pending":
                continue
            if err == "slow_down":
                interval += 2
                continue
            print(json.dumps(body), file=sys.stderr)
            raise typer.Exit(1)

    print(json.dumps({"error": "Device login timed out"}), file=sys.stderr)
    raise typer.Exit(1)
