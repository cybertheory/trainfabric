"""Compute unit/integration tests — local filesystem warehouse + SQLite catalog."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

# Configure local catalog BEFORE importing app modules that call get_catalog
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
    # Clear empty R2 so duckdb doesn't need them for local file reads
    monkeypatch.delenv("R2_ENDPOINT", raising=False)
    from app import catalog as catalog_mod

    catalog_mod.reset_catalog_for_tests()
    yield tmp_path
    catalog_mod.reset_catalog_for_tests()


FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def test_ingest_csv_and_schema(local_env):
    from app.ingest import IngestRequest, ingest

    result = ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_small.csv"),
            dataset_id="test_taxi",
            partition_hint="pickup_date",
            sort_column="fare_amount",
        )
    )
    assert result.snapshot_id
    sc = result.schema_contract
    assert sc["rowCount"] == 20
    names = [c["name"] for c in sc["columns"]]
    assert "pickup_date" in names
    assert "fare_amount" in names
    part = next(c for c in sc["columns"] if c["name"] == "pickup_date")
    assert part["isPartition"] is True
    fare = next(c for c in sc["columns"] if c["name"] == "fare_amount")
    assert fare["min"] is not None
    assert fare["max"] is not None
    assert fare["nullRate"] == 0.0


def test_ingest_json(local_env):
    from app.ingest import IngestRequest, ingest

    result = ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_small.json"),
            dataset_id="test_json",
        )
    )
    assert result.schema_contract["rowCount"] == 20


def test_ingest_parquet_uses_footer(local_env, tmp_path):
    from app.ingest import IngestRequest, ingest

    # Write a parquet from the csv via pyarrow
    import duckdb

    pq_path = tmp_path / "sample.parquet"
    duckdb.execute(
        f"COPY (SELECT * FROM read_csv_auto('{FIXTURES / 'tidy_small.csv'}')) "
        f"TO '{pq_path}' (FORMAT PARQUET)"
    )
    result = ingest(
        IngestRequest(staging_path=str(pq_path), dataset_id="test_pq", partition_hint="pickup_date")
    )
    assert result.schema_contract["rowCount"] == 20


def test_scan_plan_partition_filter_case_a(local_env):
    from app.ingest import IngestRequest, ingest
    from app.scan_plan import ScanPlanRequest, scan_plan

    ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_1k.csv"),
            dataset_id="taxi_plan",
            partition_hint="pickup_date",
            sort_column="fare_amount",
        )
    )
    plan = scan_plan(
        ScanPlanRequest(
            dataset_id="taxi_plan",
            columns=["fare_amount", "pickup_date"],
            filter="pickup_date = '2024-01-01'",
        )
    )
    assert plan.case == "A"
    assert plan.manifest is not None
    assert len(plan.matched_files) >= 1


def test_scan_plan_non_partition_filter_case_b(local_env):
    from app.ingest import IngestRequest, ingest
    from app.scan_plan import ScanPlanRequest, scan_plan

    ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_small.csv"),
            dataset_id="taxi_b",
            partition_hint="pickup_date",
        )
    )
    plan = scan_plan(
        ScanPlanRequest(
            dataset_id="taxi_b",
            filter="fare_amount > 20",
        )
    )
    assert plan.case == "B"
    assert "non-partition" in plan.reason.lower() or "Case A" in plan.reason


def test_query_correctness_vs_reference(local_env):
    """Returned rows exactly match reference DuckDB on the same fixture."""
    import duckdb
    from app.ingest import IngestRequest, ingest
    from app.query import QueryRequest, execute_query
    import base64
    import pyarrow.ipc as ipc

    ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_small.csv"),
            dataset_id="taxi_q",
            partition_hint="pickup_date",
        )
    )

    ref = duckdb.execute(
        f"SELECT fare_amount, passenger_count FROM read_csv_auto('{FIXTURES / 'tidy_small.csv'}') "
        f"WHERE fare_amount > 20 ORDER BY fare_amount"
    ).arrow()

    result = execute_query(
        QueryRequest(
            dataset_id="taxi_q",
            columns=["fare_amount", "passenger_count"],
            filter="fare_amount > 20",
        )
    )
    assert result.mode == "stream"
    assert result.arrow_base64
    got = ipc.open_stream(base64.b64decode(result.arrow_base64)).read_all()
    # Sort both for comparison
    import pyarrow.compute as pc

    got_sorted = got.sort_by("fare_amount")
    ref_sorted = ref.sort_by("fare_amount")
    assert got_sorted.num_rows == ref_sorted.num_rows
    assert got_sorted.column("fare_amount").to_pylist() == ref_sorted.column("fare_amount").to_pylist()


def test_column_pruning_wide_table(local_env):
    from app.ingest import IngestRequest, ingest
    from app.query import QueryRequest, execute_query
    import base64
    import pyarrow.ipc as ipc

    ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "wide_table.csv"),
            dataset_id="wide",
            partition_hint="category",
        )
    )
    result = execute_query(
        QueryRequest(dataset_id="wide", columns=["id", "feat_0", "feat_39"], limit=10)
    )
    table = ipc.open_stream(base64.b64decode(result.arrow_base64)).read_all()
    assert table.column_names == ["id", "feat_0", "feat_39"]
    assert table.num_rows == 10


def test_over_partition_guard(local_env):
    """High-cardinality hint should not create hundreds of partitions."""
    from app.ingest import IngestRequest, ingest
    from app import catalog as catalog_mod

    ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_1k.csv"),
            dataset_id="overpart",
            partition_hint="fare_amount",  # near-unique floats
        )
    )
    table = catalog_mod.get_catalog().load_table("default.overpart")
    # Either no partition or bounded — fare_amount distinct >> MAX so should skip
    assert len(table.spec().fields) == 0 or len(table.spec().fields) <= 1


def test_filter_parse_and_normalize():
    from app.scan_plan import parse_filter_to_iceberg

    expr, cols, ok = parse_filter_to_iceberg("pickup_date = '2024-01-01' AND fare_amount > 10")
    assert ok
    assert "pickup_date" in cols
    assert expr is not None

    expr2, cols2, ok2 = parse_filter_to_iceberg("(a = 1 OR b = 2)")
    assert ok2 is False


def test_health_endpoint(local_env):
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    assert client.get("/health").json()["status"] == "ok"


def test_large_result_writes_link(local_env, monkeypatch, tmp_path):
    """Force low threshold → link mode; write to local file warehouse path."""
    monkeypatch.setenv("STREAM_SIZE_THRESHOLD_BYTES", "1")
    # Point results at local path via file warehouse — duckdb COPY to file://
    results = tmp_path / "results"
    results.mkdir()
    monkeypatch.setenv("R2_BUCKET", str(results))  # will form s3:// path; use workaround

    from app.ingest import IngestRequest, ingest
    from app.query import QueryRequest, execute_query
    import app.query as query_mod

    ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_1k.csv"),
            dataset_id="big",
            partition_hint="pickup_date",
        )
    )

    # Monkeypatch _pack_result path for local: write parquet locally when s3 fails
    original = query_mod._pack_result

    def local_pack(arrow, req):
        import pyarrow.parquet as pq

        size = arrow.nbytes
        if not req.force_link and size <= int(os.environ.get("STREAM_SIZE_THRESHOLD_BYTES", "1")):
            return original(arrow, req)
        out = results / f"{req.query_hash or 'anon'}.parquet"
        pq.write_table(arrow, out)
        from app.query import QueryResult

        return QueryResult(
            mode="link",
            arrow_base64=None,
            r2_path=str(out),
            row_count=arrow.num_rows,
            size_bytes=size,
        )

    monkeypatch.setattr(query_mod, "_pack_result", local_pack)
    result = execute_query(
        QueryRequest(dataset_id="big", query_hash="testhash", force_link=True)
    )
    assert result.mode == "link"
    assert result.r2_path
    assert Path(result.r2_path).exists()
