"""Cloudflare AI Gateway (OpenAI-compatible) client."""

from __future__ import annotations

import json
import os
from typing import Any, Optional

import httpx


class AIGatewayError(RuntimeError):
    pass


def gateway_config() -> dict[str, str]:
    account = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID") or ""
    gateway = os.environ.get("CF_AI_GATEWAY_ID") or os.environ.get("AI_GATEWAY_ID") or "default"
    token = (
        os.environ.get("CF_AI_GATEWAY_TOKEN")
        or os.environ.get("CF_AIG_TOKEN")
        or os.environ.get("CLOUDFLARE_API_TOKEN")
        or ""
    )
    # Prefer unified AI REST API; fall back to classic gateway.ai.cloudflare.com/compat
    base = os.environ.get("CF_AI_GATEWAY_BASE")
    if not base:
        if account:
            base = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1"
        else:
            base = ""
    model = os.environ.get("CF_AI_MODEL") or os.environ.get("AI_GATEWAY_MODEL") or "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    return {
        "account_id": account,
        "gateway_id": gateway,
        "token": token,
        "base_url": base.rstrip("/"),
        "model": model,
    }


def chat_completions(
    messages: list[dict[str, Any]],
    tools: Optional[list[dict[str, Any]]] = None,
    *,
    model: Optional[str] = None,
    temperature: float = 0.1,
    timeout: float = 90.0,
) -> dict[str, Any]:
    cfg = gateway_config()
    if not cfg["base_url"] or not cfg["token"]:
        raise AIGatewayError(
            "Cloudflare AI Gateway not configured "
            "(set CF_ACCOUNT_ID + CF_AI_GATEWAY_TOKEN, or CF_AI_GATEWAY_BASE + token)"
        )

    url = f"{cfg['base_url']}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['token']}",
        "Content-Type": "application/json",
    }
    # When using unified AI API with Workers AI models, gateway id helps routing
    if cfg["gateway_id"]:
        headers["cf-aig-gateway-id"] = cfg["gateway_id"]

    body: dict[str, Any] = {
        "model": model or cfg["model"],
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    with httpx.Client(timeout=timeout) as client:
        res = client.post(url, headers=headers, json=body)
        if res.status_code >= 400:
            raise AIGatewayError(f"AI Gateway {res.status_code}: {res.text[:2000]}")
        return res.json()


def mockable_chat(
    messages: list[dict[str, Any]],
    tools: Optional[list[dict[str, Any]]] = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Allow tests to inject CF_AI_GATEWAY_MOCK_JSON responses."""
    mock = os.environ.get("CF_AI_GATEWAY_MOCK_JSON")
    if mock:
        return json.loads(mock)
    return chat_completions(messages, tools, **kwargs)
