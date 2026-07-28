"""Cloudflare AI Gateway — re-export the same Hermes package as compute.

On Box golden images, `app.hermes.gateway` lives under ~/trainfabric.
Falls back to an inline client if Hermes is not on PYTHONPATH yet.
"""

from __future__ import annotations

try:
    from app.hermes.gateway import (  # noqa: F401
        AIGatewayError,
        chat_completions,
        gateway_config,
        gateway_configured,
        mockable_chat,
    )

    chat_completion = chat_completions
except ImportError:  # pragma: no cover
    import json
    import os
    from typing import Any, Optional

    try:
        import httpx
    except ImportError:
        httpx = None  # type: ignore

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
        base = os.environ.get("CF_AI_GATEWAY_BASE")
        if not base:
            base = (
                f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1" if account else ""
            )
        model = (
            os.environ.get("CF_AI_MODEL")
            or os.environ.get("AI_GATEWAY_MODEL")
            or "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
        )
        return {
            "account_id": account,
            "gateway_id": gateway,
            "token": token,
            "base_url": base.rstrip("/"),
            "model": model,
        }

    def gateway_configured() -> bool:
        cfg = gateway_config()
        return bool(cfg["token"] and cfg["base_url"])

    def chat_completions(
        messages: list[dict[str, Any]],
        tools: Optional[list[dict[str, Any]]] = None,
        *,
        model: Optional[str] = None,
        temperature: float = 0.1,
        timeout: float = 90.0,
    ) -> dict[str, Any]:
        if httpx is None:
            raise AIGatewayError("httpx required for AI Gateway")
        cfg = gateway_config()
        if not cfg["token"] or not cfg["base_url"]:
            raise AIGatewayError("CF_AI_GATEWAY_TOKEN / CF_ACCOUNT_ID required")
        url = f"{cfg['base_url']}/chat/completions"
        body: dict[str, Any] = {
            "model": model or cfg["model"],
            "messages": messages,
            "temperature": temperature,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        headers = {
            "Authorization": f"Bearer {cfg['token']}",
            "Content-Type": "application/json",
        }
        if cfg["gateway_id"]:
            headers["cf-aig-gateway-id"] = cfg["gateway_id"]
        with httpx.Client(timeout=timeout) as client:
            res = client.post(url, headers=headers, json=body)
        if res.status_code >= 400:
            raise AIGatewayError(f"AI Gateway {res.status_code}: {res.text[:400]}")
        return res.json()

    chat_completion = chat_completions

    def mockable_chat(
        messages: list[dict[str, Any]],
        tools: Optional[list[dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        mock = os.environ.get("CF_AI_GATEWAY_MOCK_JSON")
        if mock:
            return json.loads(mock)
        return chat_completions(messages, tools, **kwargs)
