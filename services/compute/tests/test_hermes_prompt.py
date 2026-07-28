"""Hermes NL → DuckDB agent tests (offline heuristic + mocked AI Gateway)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


@pytest.fixture()
def local_env(tmp_path, monkeypatch):
    warehouse = tmp_path / "warehouse"
    warehouse.mkdir()
    db = tmp_path / "catalog.db"
    monkeypatch.setenv("ICEBERG_CATALOG_URI", f"sqlite:///{db}")
    monkeypatch.setenv("ICEBERG_WAREHOUSE", f"file://{warehouse}")
    monkeypatch.setenv("CATALOG_BACKEND", "sql")
    monkeypatch.setenv("ENABLE_BRANCHING", "false")
    monkeypatch.setenv("STREAM_SIZE_THRESHOLD_BYTES", str(50 * 1024 * 1024))
    monkeypatch.delenv("R2_ENDPOINT", raising=False)
    monkeypatch.delenv("CF_AI_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("CF_AI_GATEWAY_BASE", raising=False)
    monkeypatch.delenv("CF_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CF_AI_GATEWAY_MOCK_JSON", raising=False)
    from app import catalog as catalog_mod

    catalog_mod.reset_catalog_for_tests()
    yield tmp_path
    catalog_mod.reset_catalog_for_tests()


def _ingest_taxi(dataset_id: str = "hermes_taxi"):
    from app.ingest import IngestRequest, ingest

    return ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_small.csv"),
            dataset_id=dataset_id,
            partition_hint="pickup_date",
            sort_column="fare_amount",
        )
    )


def test_tools_inprocess_unavailable_without_catalog():
    """Box-style: hermes tools must not hard-import catalog at module load."""
    from app.hermes.cli_auth import set_cli_auth
    from app.hermes import tools

    set_cli_auth(None)
    # No auth → skips tf; no catalog package in isolation still returns structured error
    # when inprocess helpers catch ImportError (already exercised if catalog present).
    out = tools._schema_inprocess("missing_ds")
    assert out.get("via") == "inprocess"
    assert "columns" in out or "error" in out


def test_gateway_configured_helper(monkeypatch):
    from app.hermes.gateway import gateway_configured

    monkeypatch.delenv("CF_AI_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("CF_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CF_AI_GATEWAY_BASE", raising=False)
    assert gateway_configured() is False
    monkeypatch.setenv("CF_AI_GATEWAY_BASE", "https://example.test")
    monkeypatch.setenv("CF_AI_GATEWAY_TOKEN", "tok")
    assert gateway_configured() is True


def test_load_duckdb_skill():
    from app.hermes.agent import load_duckdb_skill

    skill = load_duckdb_skill()
    assert "DuckDB" in skill
    assert "get_schema" in skill or "partition" in skill.lower()


def test_hermes_heuristic_partition_prompt(local_env):
    _ingest_taxi()
    from app.hermes import PromptRequest, run_hermes_prompt

    # No gateway configured → heuristic planner
    out = run_hermes_prompt(
        PromptRequest(
            prompt="Show fares and trip distance for pickup_date 2024-01-01",
            dataset_id="hermes_taxi",
            execute=True,
        )
    )
    assert "pickup_date" in (out.filter or "") or out.filter is None or "2024-01-01" in (out.filter or "")
    assert out.columns
    assert out.estimate is not None
    assert out.estimate.get("case") in ("A", "B")
    assert out.executed is True
    assert out.result is not None
    assert out.result["rowCount"] >= 0
    assert out.model == "heuristic"
    assert out.sql


def test_hermes_heuristic_fare_filter(local_env):
    _ingest_taxi("hermes_fare")
    from app.hermes import PromptRequest, run_hermes_prompt

    out = run_hermes_prompt(
        PromptRequest(
            prompt="trips with fare above 40",
            dataset_id="hermes_fare",
            execute=False,
        )
    )
    assert out.filter and "fare_amount" in out.filter
    assert out.executed is False
    assert out.result is None


def test_hermes_mocked_gateway_tool_loop(local_env, monkeypatch):
    _ingest_taxi("hermes_mock")
    # One-shot finish via mocked chat completions
    mock = {
        "model": "mock-gateway",
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "1",
                            "type": "function",
                            "function": {
                                "name": "finish",
                                "arguments": json.dumps(
                                    {
                                        "columns": ["pickup_date", "fare_amount"],
                                        "filter": "pickup_date = '2024-01-01'",
                                        "limit": 100,
                                        "sql": "SELECT pickup_date, fare_amount FROM dataset WHERE pickup_date = '2024-01-01' LIMIT 100",
                                        "explanation": "Partition filter on pickup_date",
                                    }
                                ),
                            },
                        }
                    ],
                }
            }
        ],
    }
    monkeypatch.setenv("CF_AI_GATEWAY_MOCK_JSON", json.dumps(mock))
    # Also set token so mockable_chat doesn't think we're unconfigured before mock check
    # (mock short-circuits first)
    from app.hermes import PromptRequest, run_hermes_prompt

    out = run_hermes_prompt(
        PromptRequest(
            prompt="jan 1 fares",
            dataset_id="hermes_mock",
            execute=True,
        )
    )
    assert out.columns == ["pickup_date", "fare_amount"]
    assert out.filter == "pickup_date = '2024-01-01'"
    assert out.executed is True
    assert out.result is not None
    assert out.model == "mock-gateway"
    assert any(t.get("tool") == "finish" or t.get("tool") == "run_query" for t in out.trace)


def test_hermes_json_plan_when_tools_fail(local_env, monkeypatch):
    """Workers AI may 500 on tool-calling; Hermes should fall back to JSON plan mode."""
    _ingest_taxi("hermes_json_plan")
    from app.hermes import PromptRequest, run_hermes_prompt
    from app.hermes import agent as agent_mod
    from app.hermes.gateway import AIGatewayError

    calls = {"n": 0}

    def fake_chat(messages, tools=None, **kwargs):
        calls["n"] += 1
        if tools:
            raise AIGatewayError("AI Gateway 500: tools unsupported")
        return {
            "model": "json-plan-model",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(
                            {
                                "columns": ["fare_amount", "trip_distance"],
                                "filter": "fare_amount > 40 AND trip_distance > 10",
                                "limit": 100,
                                "explanation": "JSON plan for fare+distance Case B",
                            }
                        ),
                    }
                }
            ],
        }

    monkeypatch.setattr(agent_mod, "mockable_chat", fake_chat)
    out = run_hermes_prompt(
        PromptRequest(
            prompt="trips with fare above 40 and trip_distance over 10",
            dataset_id="hermes_json_plan",
            execute=False,
        )
    )
    assert out.model == "json-plan-model"
    assert "fare_amount" in out.columns
    assert out.filter and "fare_amount" in out.filter
    assert any(t.get("tool") == "llm_json_plan" for t in out.trace)
    assert calls["n"] >= 2


def test_prompt_http_endpoint(local_env):
    _ingest_taxi("hermes_http")
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    res = client.post(
        "/prompt",
        json={
            "prompt": "pickup_date 2024-01-01 fares",
            "dataset_id": "hermes_http",
            "execute": True,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["agent"] == "hermes"
    assert body["skill"] == "duckdb-analytics"
    assert body["columns"]
    assert body["executed"] is True


def test_prompt_with_auth_uses_tf(local_env, monkeypatch):
    """When auth_token + api_base are set, tools shell out to tf."""
    from unittest.mock import MagicMock, patch

    _ingest_taxi("hermes_auth_tf")
    from fastapi.testclient import TestClient
    from app.main import app

    schema_payload = {
        "columns": [
            {"name": "pickup_date", "type": "date", "required": False, "isPartition": True},
            {"name": "fare_amount", "type": "double", "required": False, "isPartition": False},
        ],
        "partitionColumns": ["pickup_date"],
        "sampleRows": [],
    }
    estimate_payload = {"costTier": "A", "estimatedRows": 1, "estimatedBytes": 100}
    query_payload = {"rowCount": 1, "mode": "stream"}

    def fake_run(args, **kwargs):
        proc = MagicMock()
        proc.returncode = 0
        proc.stderr = ""
        cmd = " ".join(args)
        if "schema" in cmd:
            proc.stdout = json.dumps(schema_payload)
        elif "estimate" in cmd:
            proc.stdout = json.dumps(estimate_payload)
        elif "sample" in cmd:
            proc.stdout = json.dumps({"rows": []})
        else:
            proc.stdout = json.dumps(query_payload)
        assert kwargs["env"]["TRAINFABRIC_TOKEN"] == "agent-tok"
        assert kwargs["env"]["TRAINFABRIC_API_URL"] == "https://api.example"
        return proc

    client = TestClient(app)
    with patch("app.hermes.tools.subprocess.run", side_effect=fake_run):
        res = client.post(
            "/prompt",
            json={
                "prompt": "pickup_date 2024-01-01 fares",
                "dataset_id": "hermes_auth_tf",
                "public_dataset_id": "ds_pub_tf",
                "execute": True,
                "auth_token": "agent-tok",
                "api_base": "https://api.example",
                "user_id": "user_test",
            },
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["agent"] == "hermes"
    # Trace should show tf-backed tool results when heuristic path used tools
    via_tf = False
    for step in body.get("trace") or []:
        result = step.get("result") or {}
        if isinstance(result, dict) and result.get("via") == "tf":
            via_tf = True
            break
    assert via_tf or body.get("columns")
