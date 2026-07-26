"""tf CLI + Hermes CLI auth wiring tests."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def test_cli_auth_contextvar():
    from app.hermes.cli_auth import CliAuthContext, get_cli_auth, set_cli_auth

    assert get_cli_auth() is None
    set_cli_auth(
        CliAuthContext(
            api_base="https://example.test",
            auth_token="tok",
            public_dataset_id="ds_abc",
            user_id="user_1",
        )
    )
    ctx = get_cli_auth()
    assert ctx is not None
    assert ctx.auth_token == "tok"
    assert ctx.public_dataset_id == "ds_abc"
    set_cli_auth(None)
    assert get_cli_auth() is None


def test_tools_call_tf_when_auth_present():
    from app.hermes.cli_auth import CliAuthContext, set_cli_auth
    from app.hermes import tools

    set_cli_auth(
        CliAuthContext(
            api_base="https://api.example",
            auth_token="agent-jwt",
            public_dataset_id="ds_pub",
        )
    )

    payload = {
        "columns": [{"name": "a", "type": "string", "required": False, "isPartition": False}],
        "partitionColumns": [],
    }

    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.stdout = json.dumps(payload)
    mock_proc.stderr = ""

    with patch("app.hermes.tools.subprocess.run", return_value=mock_proc) as run:
        out = tools.get_schema("iceberg_table")
        assert out.get("via") == "tf"
        assert run.called
        args, kwargs = run.call_args
        assert args[0][0] == "tf"
        assert "ds_pub" in args[0]
        assert kwargs["env"]["TRAINFABRIC_TOKEN"] == "agent-jwt"
        assert kwargs["env"]["TRAINFABRIC_API_URL"] == "https://api.example"

    # estimate / sample / query also shell out
    mock_proc.stdout = json.dumps({"costTier": "A", "estimatedRows": 10})
    with patch("app.hermes.tools.subprocess.run", return_value=mock_proc):
        est = tools.estimate_query("iceberg_table", columns=["a"], filter="a = 1")
        assert est.get("via") == "tf"
        assert est.get("case") == "A"

    mock_proc.stdout = json.dumps({"rows": [{"a": 1}]})
    with patch("app.hermes.tools.subprocess.run", return_value=mock_proc):
        samp = tools.sample_rows("iceberg_table", 2)
        assert samp.get("via") == "tf"

    mock_proc.stdout = json.dumps({"rowCount": 1})
    with patch("app.hermes.tools.subprocess.run", return_value=mock_proc):
        q = tools.run_query("iceberg_table", columns=["a"], limit=5)
        assert q.get("via") == "tf"

    set_cli_auth(None)


def test_tools_tf_error_and_normalize():
    from app.hermes.cli_auth import CliAuthContext, set_cli_auth
    from app.hermes import tools

    set_cli_auth(
        CliAuthContext(api_base="https://api.example", auth_token="t", public_dataset_id="ds_1")
    )

    # Non-zero exit with JSON error
    bad = MagicMock(returncode=1, stdout='{"error":"boom"}', stderr="")
    with patch("app.hermes.tools.subprocess.run", return_value=bad):
        out = tools._run_tf(["schema", "ds_1"])
        assert out is not None
        assert out.get("error") == "boom"
        assert out.get("via") == "tf"

    # FileNotFoundError → None (caller falls back)
    with patch("app.hermes.tools.subprocess.run", side_effect=FileNotFoundError("tf")):
        assert tools._run_tf(["schema", "ds_1"]) is None

    # Schema REST normalize path
    ok = MagicMock(
        returncode=0,
        stdout=json.dumps(
            {
                "columns": [
                    {"name": "pickup_date", "type": "date", "isPartition": True},
                    {"name": "fare_amount", "dataType": "double"},
                ]
            }
        ),
        stderr="",
    )
    with patch("app.hermes.tools.subprocess.run", return_value=ok):
        schema = tools.get_schema("ignored")
        assert schema["via"] == "tf"
        assert "pickup_date" in schema.get("partitionColumns", [])

    set_cli_auth(None)


def test_tools_skip_tf_without_auth():
    from app.hermes.cli_auth import set_cli_auth
    from app.hermes import tools

    set_cli_auth(None)
    with patch("app.hermes.tools.subprocess.run") as run:
        assert tools._run_tf(["schema", "x"]) is None
        assert run.call_count == 0


def test_dispatch_tool_finish_and_unknown():
    from app.hermes.tools import dispatch_tool

    fin = dispatch_tool(
        "finish",
        {"columns": ["a"], "explanation": "done"},
        dataset_id="x",
        namespace="default",
        allow_execute=False,
    )
    assert fin.get("__finish__") is True

    unk = dispatch_tool("nope", {}, dataset_id="x", namespace="default", allow_execute=True)
    assert "error" in unk

    blocked = dispatch_tool(
        "run_query",
        {"columns": ["a"]},
        dataset_id="x",
        namespace="default",
        allow_execute=False,
    )
    assert "execute=false" in blocked["error"]


def _fake_client(status: int, data):
    class FakeResp:
        status_code = status
        text = json.dumps(data)

        def json(self):
            return data

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def request(self, method, url, headers=None, json=None):
            FakeClient.last = {"method": method, "url": url, "headers": headers, "json": json}
            return FakeResp()

    return FakeClient


def test_tf_cli_commands(monkeypatch):
    from app.tf_cli import app

    monkeypatch.setenv("TRAINFABRIC_API_URL", "https://api.example")
    monkeypatch.setenv("TRAINFABRIC_TOKEN", "tok")
    monkeypatch.setenv("TRAINFABRIC_DATASET_ID", "ds_default")

    runner = CliRunner()
    FakeClient = _fake_client(200, {"ok": True, "columns": []})

    with patch("app.tf_cli.httpx.Client", FakeClient):
        assert runner.invoke(app, ["schema", "ds_1"]).exit_code == 0
        assert "/datasets/ds_1/schema" in FakeClient.last["url"]

        assert runner.invoke(app, ["sample", "ds_1", "-n", "3"]).exit_code == 0
        assert FakeClient.last["json"] == {"n": 3}

        assert runner.invoke(
            app, ["estimate", "ds_1", "--columns", "a,b", "--filter", "a = 1"]
        ).exit_code == 0
        assert FakeClient.last["json"]["columns"] == ["a", "b"]

        assert runner.invoke(
            app, ["query", "ds_1", "--columns", "a", "--filter", "a = 1", "--limit", "10"]
        ).exit_code == 0
        assert FakeClient.last["json"]["limit"] == 10
        assert FakeClient.last["json"]["filter"] == "a = 1"

        assert runner.invoke(app, ["discover", "--search", "taxi", "--tag", "demo"]).exit_code == 0
        assert "search=taxi" in FakeClient.last["url"]


def test_tf_whoami_local_decode(monkeypatch):
    import base64

    from app.tf_cli import app

    payload = (
        base64.urlsafe_b64encode(
            json.dumps({"sub": "user_x", "email": "a@b.c", "iss": "trainfabric-agent"}).encode()
        )
        .decode()
        .rstrip("=")
    )
    token = f"hdr.{payload}.sig"

    monkeypatch.setenv("TRAINFABRIC_API_URL", "https://api.example")
    monkeypatch.setenv("TRAINFABRIC_TOKEN", token)

    runner = CliRunner()
    FakeClient = _fake_client(401, {"error": "unauthorized"})

    with patch("app.tf_cli.httpx.Client", FakeClient):
        result = runner.invoke(app, ["whoami"])
    out = result.stdout + result.stderr
    assert "user_x" in out
    assert "local_decode" in out


def test_dispatch_tool_schema_estimate_sample(local_env):
    from app.ingest import IngestRequest, ingest
    from app.hermes.tools import dispatch_tool

    ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_small.csv"),
            dataset_id="dispatch_ds",
            partition_hint="pickup_date",
        )
    )
    schema = dispatch_tool(
        "get_schema", {}, dataset_id="dispatch_ds", namespace="default", allow_execute=True
    )
    assert "columns" in schema
    est = dispatch_tool(
        "estimate_query",
        {"columns": ["fare_amount"], "filter": "pickup_date = '2024-01-01'"},
        dataset_id="dispatch_ds",
        namespace="default",
        allow_execute=True,
    )
    assert est.get("case") in ("A", "B") or est.get("via")
    samp = dispatch_tool(
        "sample_rows", {"n": 2}, dataset_id="dispatch_ds", namespace="default", allow_execute=True
    )
    assert "rows" in samp or samp.get("via")


# Reuse local_env fixture definition pattern from ingest tests
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
    from app import catalog as catalog_mod

    catalog_mod.reset_catalog_for_tests()
    yield tmp_path
    catalog_mod.reset_catalog_for_tests()


def test_tools_tf_subprocess_edge_cases():
    from app.hermes.cli_auth import CliAuthContext, set_cli_auth
    from app.hermes import tools

    set_cli_auth(CliAuthContext(api_base="https://api.example", auth_token="t"))

    with patch("app.hermes.tools.subprocess.run", side_effect=RuntimeError("boom")):
        out = tools._run_tf(["schema", "x"])
        assert out is not None and "boom" in out.get("error", "")

    empty = MagicMock(returncode=0, stdout="", stderr="")
    with patch("app.hermes.tools.subprocess.run", return_value=empty):
        out = tools._run_tf(["schema", "x"])
        assert out is not None and "error" in out

    badjson = MagicMock(returncode=0, stdout="not-json{", stderr="")
    with patch("app.hermes.tools.subprocess.run", return_value=badjson):
        out = tools._run_tf(["schema", "x"])
        assert out is not None and "error" in out

    err = MagicMock(returncode=1, stdout='{"error":"qfail"}', stderr="")
    with patch("app.hermes.tools.subprocess.run", return_value=err):
        q = tools.run_query("x", columns=["a"])
        assert q.get("error") == "qfail"

    set_cli_auth(None)

    with patch("app.hermes.tools.execute_query", side_effect=RuntimeError("exec fail")):
        q2 = tools.run_query("x", columns=["a"])
        assert "exec fail" in q2.get("error", "")

    with patch("app.hermes.tools.sample_rows_fn", side_effect=RuntimeError("no sample")):
        bad = tools.sample_rows("missing_ds", 1)
        assert "error" in bad


def test_tf_cli_token_and_dataset_required(monkeypatch):
    from app.tf_cli import app

    runner = CliRunner()
    monkeypatch.setenv("TRAINFABRIC_API_URL", "https://api.example")
    monkeypatch.delenv("TRAINFABRIC_TOKEN", raising=False)
    assert runner.invoke(app, ["schema", "ds_1"]).exit_code == 2

    monkeypatch.setenv("TRAINFABRIC_TOKEN", "tok")
    monkeypatch.delenv("TRAINFABRIC_DATASET_ID", raising=False)
    assert runner.invoke(app, ["schema"]).exit_code == 2

    FakeClient = _fake_client(500, {"error": "server"})
    with patch("app.tf_cli.httpx.Client", FakeClient):
        assert runner.invoke(app, ["schema", "ds_1"]).exit_code == 1

    class BadResp:
        status_code = 200
        text = "not-json"

        def json(self):
            raise ValueError("nope")

    class BadClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def request(self, *a, **k):
            return BadResp()

    with patch("app.tf_cli.httpx.Client", BadClient):
        assert runner.invoke(app, ["schema", "ds_1"]).exit_code == 0


def test_tf_cli_http_transport_error(monkeypatch):
    import httpx
    from app.tf_cli import app

    monkeypatch.setenv("TRAINFABRIC_API_URL", "https://api.example")
    monkeypatch.setenv("TRAINFABRIC_TOKEN", "tok")
    runner = CliRunner()

    class BoomClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def request(self, *a, **k):
            raise httpx.ConnectError("down")

    with patch("app.tf_cli.httpx.Client", BoomClient):
        assert runner.invoke(app, ["schema", "ds_1"]).exit_code == 1


def test_tf_cli_missing_url_only(monkeypatch):
    from app.tf_cli import app

    monkeypatch.delenv("TRAINFABRIC_API_URL", raising=False)
    monkeypatch.setenv("TRAINFABRIC_TOKEN", "tok")
    runner = CliRunner()
    assert runner.invoke(app, ["schema", "ds_1"]).exit_code == 2


def test_tf_cli_main_entrypoint():
    from app import tf_cli

    with patch.object(tf_cli, "app") as mock_app:
        tf_cli.main()
        mock_app.assert_called_once()


def test_tf_decode_jwt_edge_cases():
    import base64

    from app.tf_cli import _decode_jwt_claims

    assert _decode_jwt_claims("nodots") == {}
    bad = base64.urlsafe_b64encode(b"\xff\xfe").decode().rstrip("=")
    assert _decode_jwt_claims(f"h.{bad}.s") == {}
    assert _decode_jwt_claims("h.!!!garbage!!!.s") == {}
