"""Trainfabric CLI (`tf`) — REST client for Hermes / agents.

Auth (first match wins):
  TRAINFABRIC_TOKEN env — Clerk JWT, Clerk ak_*, Trainfabric tfak_*, or agent JWT
  ~/.config/trainfabric/credentials.json — from `tf login`

Also:
  TRAINFABRIC_API_URL — router base (default: production worker)
  TRAINFABRIC_DATASET_ID — optional default dataset id
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Optional

import httpx
import typer

from .credentials import (
    credentials_path,
    device_login,
    load_credentials,
    resolve_api_url,
    resolve_token,
)

app = typer.Typer(add_completion=False, no_args_is_help=True, help="Trainfabric CLI")
auth_app = typer.Typer(add_completion=False, help="Authentication")
app.add_typer(auth_app, name="auth")


def _api_url() -> str:
    base = resolve_api_url()
    if not base:
        print(json.dumps({"error": "TRAINFABRIC_API_URL not set"}), file=sys.stderr)
        raise typer.Exit(2)
    return base


def _token() -> str:
    tok = resolve_token()
    if not tok:
        print(
            json.dumps(
                {
                    "error": "Not authenticated",
                    "hint": "Run `tf login` or set TRAINFABRIC_TOKEN",
                }
            ),
            file=sys.stderr,
        )
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


@app.command("login")
def login(
    open_browser: bool = typer.Option(True, "--open/--no-open", help="Open verification URL"),
) -> None:
    """Device login — approve in the dashboard, store an API key locally."""
    print(json.dumps(device_login(open_browser=open_browser), default=str))


@app.command("logout")
def logout() -> None:
    """Remove stored CLI credentials."""
    path = credentials_path()
    if path.exists():
        path.unlink()
    print(json.dumps({"ok": True, "removed": str(path)}))


@auth_app.command("status")
def auth_status() -> None:
    """Show whether a token is configured and call /auth/whoami when possible."""
    env_tok = bool(os.environ.get("TRAINFABRIC_TOKEN"))
    stored = load_credentials()
    out: dict[str, Any] = {
        "api_url": resolve_api_url(),
        "env_token": env_tok,
        "stored_credentials": bool(stored.get("access_token")),
        "credentials_path": str(credentials_path()),
        "subject": stored.get("subject"),
        "auth_via": stored.get("auth_via"),
    }
    if env_tok or stored.get("access_token"):
        try:
            with httpx.Client(timeout=30.0) as client:
                res = client.get(
                    f"{_api_url()}/auth/whoami",
                    headers={
                        "Authorization": f"Bearer {_token()}",
                        "Accept": "application/json",
                    },
                )
                try:
                    body = res.json()
                except Exception:
                    body = {"error": res.text[:500]}
                out["whoami"] = body if res.status_code < 400 else {"error": body, "status": res.status_code}
        except Exception as e:
            out["whoami"] = {"error": str(e)}
    print(json.dumps(out, default=str))


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


@app.command()
def connect(
    dataset_id: Optional[str] = typer.Argument(None),
    off: bool = typer.Option(False, "--off", help="Disconnect instead of connect"),
) -> None:
    """Connect (subscribe) to a dataset community — like starring."""
    ds = _dataset(dataset_id)
    _request("POST", f"/datasets/{ds}/connect", {"connected": not off})


# ---- Social feature (same interface as MCP / dashboard) ----

social_app = typer.Typer(add_completion=False, no_args_is_help=True, help="Social feed")
app.add_typer(social_app, name="social")


@social_app.command("post")
def social_post(
    dataset_id: Optional[str] = typer.Argument(None),
    body: str = typer.Option(..., "--body", "-b", help="Update / finding summary"),
    author_name: Optional[str] = typer.Option(
        None, "--author-name", help="Display name for the post (agent label)"
    ),
    findings: Optional[str] = typer.Option(
        None, "--findings", help="Optional structured findings as a JSON string"
    ),
    source: str = typer.Option("agent", "--source", help="user | agent"),
) -> None:
    """Publish a social update / research finding to a dataset community feed.

    Notifies users connected to the dataset. Same endpoint used by the MCP
    `post_social_update` tool and the dashboard composer.
    """
    ds = _dataset(dataset_id)
    payload: dict[str, Any] = {"datasetId": ds, "body": body, "source": source}
    if author_name:
        payload["authorName"] = author_name
    if findings:
        try:
            payload["findings"] = json.loads(findings)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"invalid --findings JSON: {e}"}), file=sys.stderr)
            raise typer.Exit(2) from e
    _request("POST", "/social/posts", payload)


@social_app.command("feed")
def social_feed(
    dataset_id: Optional[str] = typer.Option(None, "--dataset", "-d", help="Scope to one dataset"),
    limit: int = typer.Option(40, "--limit"),
) -> None:
    """List the social feed (connected datasets, or a specific dataset)."""
    q = [f"limit={limit}"]
    if dataset_id:
        q.append(f"datasetId={dataset_id}")
    _request("GET", "/social/feed?" + "&".join(q))


# ---- Profile ----

profile_app = typer.Typer(add_completion=False, no_args_is_help=True, help="Social identity profile")
app.add_typer(profile_app, name="profile")


@profile_app.command("show")
def profile_show() -> None:
    """Show the caller's social profile."""
    _request("GET", "/profile")


@profile_app.command("set")
def profile_set(
    display_name: Optional[str] = typer.Option(None, "--name"),
    username: Optional[str] = typer.Option(None, "--username"),
    image_url: Optional[str] = typer.Option(None, "--image"),
    bio: Optional[str] = typer.Option(None, "--bio"),
) -> None:
    """Update the caller's social profile (name / handle / avatar / bio)."""
    payload: dict[str, Any] = {}
    if display_name:
        payload["displayName"] = display_name
    if username:
        payload["username"] = username
    if image_url:
        payload["imageUrl"] = image_url
    if bio:
        payload["bio"] = bio
    if not payload:
        print(json.dumps({"error": "nothing to update"}), file=sys.stderr)
        raise typer.Exit(2)
    _request("POST", "/profile", payload)


# ---- Autoresearch /auto ----

auto_app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Start and control long-running autoresearch AutoRuns (same as MCP start_auto)",
)
app.add_typer(auto_app, name="auto")


def _parse_json_opt(raw: Optional[str], label: str) -> Any:
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"invalid {label} JSON: {e}"}), file=sys.stderr)
        raise typer.Exit(2) from e


def _load_json_file(path: Optional[str], label: str) -> Any:
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"error": f"invalid {label} file: {e}"}), file=sys.stderr)
        raise typer.Exit(2) from e


def _csv_list(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


@auto_app.command("start")
def auto_start(
    repo_url: Optional[str] = typer.Option(None, "--repo-url", help="Public GitHub repo URL"),
    repo: Optional[str] = typer.Option(
        None, "--repo", help="owner/repo (use with --installation-id for GitHub App)"
    ),
    installation_id: Optional[int] = typer.Option(
        None, "--installation-id", help="GitHub App installation id"
    ),
    branch: Optional[str] = typer.Option(None, "--branch", help="Default branch"),
    dataset_id: Optional[str] = typer.Option(
        None, "--dataset", "-d", help="Optional primary dataset hint"
    ),
    datasets: Optional[str] = typer.Option(
        None, "--datasets", help="Comma-separated dataset ids"
    ),
    goal: Optional[str] = typer.Option(
        None, "--goal", help="Optional brief override (prefer TRAINFABRIC.md in repo)"
    ),
    protocol: Optional[str] = typer.Option(
        None, "--protocol", help="Full protocol JSON object"
    ),
    protocol_file: Optional[str] = typer.Option(
        None, "--protocol-file", help="Path to protocol JSON file"
    ),
    metric: str = typer.Option("val_bpb", "--metric", help="Metric name (when not using --protocol)"),
    direction: str = typer.Option(
        "min", "--direction", help="Metric direction: min|max"
    ),
    max_trials: int = typer.Option(20, "--max-trials"),
    max_wall_sec: int = typer.Option(3600, "--max-wall-sec"),
    mutable: str = typer.Option(
        "train.py", "--mutable", help="Comma-separated mutable paths"
    ),
    immutable: str = typer.Option(
        "prepare.py,protocol.yaml",
        "--immutable",
        help="Comma-separated immutable paths",
    ),
    compute: str = typer.Option(
        "trainfabric_gpu",
        "--compute",
        help="Compute provider: trainfabric_gpu|runner (legacy: modal)",
    ),
    modal_ref: Optional[str] = typer.Option(
        None, "--modal-ref", help="Managed GPU app/web endpoint override"
    ),
    runner_id: Optional[str] = typer.Option(
        None, "--runner-id", help="Self-hosted GPU runner id"
    ),
    template_id: Optional[str] = typer.Option(None, "--template-id"),
    body: Optional[str] = typer.Option(
        None, "--body", help="Full CreateAutoRunRequest JSON (overrides other flags)"
    ),
    body_file: Optional[str] = typer.Option(
        None, "--body-file", help="Path to full CreateAutoRunRequest JSON"
    ),
) -> None:
    """Start a long-running autoresearch AutoRun (POST /auto).

    Repo-first: pass --repo-url or --repo + --installation-id. The agent loads
    TRAINFABRIC.md / AGENTS.md / README.md after clone. Same as MCP start_auto.
    """
    full = _load_json_file(body_file, "--body-file") or _parse_json_opt(body, "--body")
    if isinstance(full, dict):
        _request("POST", "/auto", full)
        return

    if not repo_url and not repo:
        print(
            json.dumps(
                {
                    "error": "repo required — pass --repo-url or --repo (+ --installation-id)",
                }
            ),
            file=sys.stderr,
        )
        raise typer.Exit(2)

    proto = _load_json_file(protocol_file, "--protocol-file") or _parse_json_opt(
        protocol, "--protocol"
    )
    if not isinstance(proto, dict):
        if direction not in ("min", "max"):
            print(json.dumps({"error": "--direction must be min or max"}), file=sys.stderr)
            raise typer.Exit(2)
        proto = {
            "metric": {"name": metric, "direction": direction},
            "budget": {"maxTrials": max_trials, "maxWallClockSec": max_wall_sec},
            "mutablePaths": _csv_list(mutable),
            "immutablePaths": _csv_list(immutable),
        }

    provider = compute.strip().lower()
    if provider == "modal":
        provider = "trainfabric_gpu"
    if provider not in ("trainfabric_gpu", "runner"):
        print(
            json.dumps({"error": "--compute must be trainfabric_gpu or runner"}),
            file=sys.stderr,
        )
        raise typer.Exit(2)
    compute_cfg: dict[str, Any] = {"provider": provider}
    if provider == "trainfabric_gpu":
        if modal_ref:
            compute_cfg["modalRef"] = modal_ref
    else:
        if not runner_id:
            print(
                json.dumps({"error": "--runner-id required when --compute=runner"}),
                file=sys.stderr,
            )
            raise typer.Exit(2)
        compute_cfg["runnerId"] = runner_id

    dataset_ids = _csv_list(datasets)
    primary = dataset_id or (dataset_ids[0] if dataset_ids else None) or os.environ.get(
        "TRAINFABRIC_DATASET_ID"
    )
    if primary and primary not in dataset_ids:
        dataset_ids = [primary, *dataset_ids]

    payload: dict[str, Any] = {
        "protocol": proto,
        "compute": compute_cfg,
    }
    if goal:
        payload["goal"] = goal
    if repo_url:
        payload["repoUrl"] = repo_url
    if repo:
        payload["repoFullName"] = repo
    if installation_id is not None:
        payload["installationId"] = installation_id
    if branch:
        payload["defaultBranch"] = branch
    if primary:
        payload["datasetId"] = primary
    if dataset_ids:
        payload["datasetIds"] = dataset_ids
    if template_id:
        payload["templateId"] = template_id

    _request("POST", "/auto", payload)


@auto_app.command("status")
def auto_status(auto_run_id: str = typer.Argument(..., help="AutoRun id")) -> None:
    """Poll AutoRun status, trials, and activity (GET /auto/:id)."""
    _request("GET", f"/auto/{auto_run_id}")


@auto_app.command("list")
def auto_list(
    dataset_id: Optional[str] = typer.Option(
        None, "--dataset", "-d", help="Scope to one dataset (GET /datasets/:id/auto)"
    ),
) -> None:
    """List AutoRuns for the caller, or for a dataset."""
    if dataset_id:
        _request("GET", f"/datasets/{dataset_id}/auto")
    else:
        _request("GET", "/auto")


@auto_app.command("pause")
def auto_pause(auto_run_id: str = typer.Argument(...)) -> None:
    """Pause an AutoRun."""
    _request("POST", f"/auto/{auto_run_id}/pause", {})


@auto_app.command("resume")
def auto_resume(auto_run_id: str = typer.Argument(...)) -> None:
    """Resume a paused AutoRun."""
    _request("POST", f"/auto/{auto_run_id}/resume", {})


@auto_app.command("cancel")
def auto_cancel(auto_run_id: str = typer.Argument(...)) -> None:
    """Cancel an AutoRun."""
    _request("POST", f"/auto/{auto_run_id}/cancel", {})


@auto_app.command("bind")
def auto_bind(
    auto_run_id: str = typer.Argument(...),
    dataset_id: str = typer.Option(..., "--dataset", "-d"),
    reason: Optional[str] = typer.Option(None, "--reason"),
) -> None:
    """Bind a dataset to an AutoRun (freezes snapshot on first bind)."""
    payload: dict[str, Any] = {"datasetId": dataset_id}
    if reason:
        payload["reason"] = reason
    _request("POST", f"/auto/{auto_run_id}/bind-dataset", payload)


@auto_app.command("message")
def auto_message(
    auto_run_id: str = typer.Argument(...),
    body: str = typer.Option(..., "--body", "-b", help="Message to the cloud agent"),
    role: str = typer.Option("user", "--role", help="user|assistant|system"),
    source: str = typer.Option("api", "--source", help="api|daemon|dashboard|mcp"),
) -> None:
    """Send a message to a running AutoRun agent (same thread as dashboard chat)."""
    _request(
        "POST",
        f"/auto/{auto_run_id}/messages",
        {"content": body, "role": role, "source": source},
    )


@auto_app.command("messages")
def auto_messages(
    auto_run_id: str = typer.Argument(...),
    limit: int = typer.Option(50, "--limit"),
) -> None:
    """Read an AutoRun conversation thread."""
    _request("GET", f"/auto/{auto_run_id}/messages?limit={limit}")


@auto_app.command("heartbeat")
def auto_heartbeat(
    auto_run_id: str = typer.Argument(...),
    phase: str = typer.Option(..., "--phase", help="running|awaiting_user|…"),
    trial: int = typer.Option(0, "--trial"),
    message: Optional[str] = typer.Option(None, "--message", "-m"),
) -> None:
    """Volunteer AutoRun liveness (Box daemon / Hermes)."""
    payload: dict[str, Any] = {"phase": phase, "trial": trial}
    if message:
        payload["message"] = message
    _request("POST", f"/auto/{auto_run_id}/heartbeat", payload)


@auto_app.command("trial")
def auto_trial(
    auto_run_id: str = typer.Argument(...),
    hypothesis: str = typer.Option(..., "--hypothesis", "-H"),
    commit_sha: str = typer.Option(..., "--commit-sha", help="Git SHA for this trial"),
) -> None:
    """Enqueue a GPU trial for an AutoRun (POST /auto/:id/trials)."""
    _request(
        "POST",
        f"/auto/{auto_run_id}/trials",
        {"hypothesis": hypothesis, "commitSha": commit_sha},
    )


@auto_app.command("instructions")
def auto_instructions(
    auto_run_id: str = typer.Argument(...),
    content: str = typer.Option(..., "--content", "-c"),
    source_file: Optional[str] = typer.Option(None, "--source-file"),
) -> None:
    """Report the repo-loaded research brief on an AutoRun."""
    payload: dict[str, Any] = {"content": content}
    if source_file:
        payload["sourceFile"] = source_file
    _request("POST", f"/auto/{auto_run_id}/instructions", payload)


@auto_app.command("github-credentials")
def auto_github_credentials(auto_run_id: str = typer.Argument(...)) -> None:
    """Refresh GitHub App installation token for this AutoRun's repo."""
    _request("POST", f"/auto/{auto_run_id}/github-credentials", {})


@app.command("prompt")
def prompt_cmd(
    dataset_id: Optional[str] = typer.Argument(None),
    prompt: str = typer.Option(..., "--prompt", "-p", help="Natural-language slice request"),
    execute: bool = typer.Option(True, "--execute/--no-execute"),
    snapshot: Optional[str] = typer.Option(None, "--snapshot"),
    local: bool = typer.Option(
        True,
        "--local/--remote",
        help="Run in-process Hermes (Box/compute) via tf; --remote posts to /datasets/:id/prompt",
    ),
) -> None:
    """Natural-language slice via Hermes (same agent as compute /prompt).

    Prefer --local on Box/compute so Hermes shells out through this CLI for
    schema/estimate/query. Use --remote to hit the router → compute container.
    """
    ds = _dataset(dataset_id)
    if local:
        try:
            from app.hermes import PromptRequest, run_hermes_prompt
        except ImportError as e:
            print(
                json.dumps(
                    {
                        "error": f"Hermes package unavailable: {e}",
                        "hint": "Install app.hermes on PYTHONPATH or use --remote",
                    }
                ),
                file=sys.stderr,
            )
            raise typer.Exit(1) from e
        out = run_hermes_prompt(
            PromptRequest(
                prompt=prompt,
                dataset_id=ds,
                execute=execute,
                snapshot=snapshot,
                auth_token=_token(),
                api_base=_api_url(),
                public_dataset_id=ds,
            )
        )
        print(
            json.dumps(
                {
                    "columns": out.columns,
                    "filter": out.filter,
                    "limit": out.limit,
                    "sql": out.sql,
                    "estimate": out.estimate,
                    "explanation": out.explanation,
                    "executed": out.executed,
                    "result": out.result,
                    "model": out.model,
                    "via": "hermes_local",
                },
                default=str,
            )
        )
        return

    body: dict[str, Any] = {"prompt": prompt, "execute": execute}
    if snapshot:
        body["snapshot"] = snapshot
    _request("POST", f"/datasets/{ds}/prompt", body)


def main() -> None:
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
