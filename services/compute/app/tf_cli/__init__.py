"""Trainfabric CLI (`tf`) — REST client for Hermes / agents.

Auth via env:
  TRAINFABRIC_API_URL  — router base URL
  TRAINFABRIC_TOKEN    — Bearer token (Clerk session or agent JWT)
  TRAINFABRIC_DATASET_ID — optional default dataset id
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Optional

import httpx
import typer

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Trainfabric CLI")


def _api_url() -> str:
    base = (os.environ.get("TRAINFABRIC_API_URL") or "").rstrip("/")
    if not base:
        print(json.dumps({"error": "TRAINFABRIC_API_URL not set"}), file=sys.stderr)
        raise typer.Exit(2)
    return base


def _token() -> str:
    tok = os.environ.get("TRAINFABRIC_TOKEN") or ""
    if not tok:
        print(json.dumps({"error": "TRAINFABRIC_TOKEN not set"}), file=sys.stderr)
        raise typer.Exit(2)
    return tok


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token()}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "trainfabric-tf-cli/1.0",
    }


def _dataset(dataset_id: Optional[str]) -> str:
    ds = dataset_id or os.environ.get("TRAINFABRIC_DATASET_ID") or ""
    if not ds:
        print(json.dumps({"error": "dataset id required (arg or TRAINFABRIC_DATASET_ID)"}), file=sys.stderr)
        raise typer.Exit(2)
    return ds


def _request(method: str, path: str, body: Any = None) -> Any:
    url = f"{_api_url()}{path}"
    try:
        with httpx.Client(timeout=120.0) as client:
            res = client.request(method, url, headers=_headers(), json=body)
    except httpx.HTTPError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        raise typer.Exit(1) from e
    try:
        data = res.json()
    except Exception:
        data = {"error": res.text[:2000]}
    if res.status_code >= 400:
        print(json.dumps(data if isinstance(data, dict) else {"error": data}), file=sys.stderr)
        raise typer.Exit(1)
    print(json.dumps(data, default=str))
    return data


def _decode_jwt_claims(token: str) -> dict[str, Any]:
    """Decode JWT payload without verifying (for local whoami display)."""
    import base64

    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        pad = "=" * (-len(parts[1]) % 4)
        raw = base64.urlsafe_b64decode(parts[1] + pad)
        return json.loads(raw.decode())
    except Exception:
        return {}


@app.command()
def whoami() -> None:
    """Show identity from /auth/whoami (or local JWT decode fallback)."""
    try:
        _request("GET", "/auth/whoami")
    except typer.Exit:
        claims = _decode_jwt_claims(_token())
        print(
            json.dumps(
                {
                    "subject": claims.get("sub"),
                    "email": claims.get("email"),
                    "dataset_id": claims.get("dataset_id"),
                    "scope": claims.get("scope"),
                    "iss": claims.get("iss"),
                    "exp": claims.get("exp"),
                    "authVia": "local_decode",
                }
            )
        )


@app.command()
def discover(
    search: Optional[str] = typer.Option(None, "--search", "-s"),
    tag: Optional[str] = typer.Option(None, "--tag", "-t"),
    limit: int = typer.Option(50, "--limit"),
) -> None:
    """List/search datasets (GET /datasets)."""
    q: list[str] = []
    if search:
        q.append(f"search={httpx.QueryParams({'search': search})['search']}")
    if tag:
        q.append(f"tag={httpx.QueryParams({'tag': tag})['tag']}")
    q.append(f"limit={limit}")
    path = "/datasets?" + "&".join(q)
    _request("GET", path)


@app.command()
def schema(dataset_id: Optional[str] = typer.Argument(None)) -> None:
    """Fetch dataset schema contract."""
    ds = _dataset(dataset_id)
    _request("GET", f"/datasets/{ds}/schema")


@app.command()
def sample(
    dataset_id: Optional[str] = typer.Argument(None),
    n: int = typer.Option(5, "-n", "--n"),
) -> None:
    """Sample rows from a dataset."""
    ds = _dataset(dataset_id)
    _request("POST", f"/datasets/{ds}/sample", {"n": n})


@app.command()
def estimate(
    dataset_id: Optional[str] = typer.Argument(None),
    columns: Optional[str] = typer.Option(None, "--columns", help="Comma-separated columns"),
    filter: Optional[str] = typer.Option(None, "--filter"),
) -> None:
    """Estimate query cost (cache / A / B)."""
    ds = _dataset(dataset_id)
    body: dict[str, Any] = {}
    if columns:
        body["columns"] = [c.strip() for c in columns.split(",") if c.strip()]
    if filter:
        body["filter"] = filter
    _request("POST", f"/datasets/{ds}/estimate", body)


@app.command("query")
def query_cmd(
    dataset_id: Optional[str] = typer.Argument(None),
    columns: Optional[str] = typer.Option(None, "--columns", help="Comma-separated columns"),
    filter: Optional[str] = typer.Option(None, "--filter"),
    limit: int = typer.Option(1000, "--limit"),
) -> None:
    """Run a slice query."""
    ds = _dataset(dataset_id)
    body: dict[str, Any] = {"limit": limit, "save": False}
    if columns:
        body["columns"] = [c.strip() for c in columns.split(",") if c.strip()]
    if filter:
        body["filter"] = filter
    _request("POST", f"/datasets/{ds}/query", body)


def main() -> None:
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
