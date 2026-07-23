"""Golden-path sketch: publish → plan A → query B → cache.

Full end-to-end with MinIO+Postgres+Worker is wired in CI when services are up.
This module asserts the compute half of §13.9 against local fixtures.
"""

from __future__ import annotations

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
    from app import catalog as catalog_mod

    catalog_mod.reset_catalog_for_tests()
    yield tmp_path
    catalog_mod.reset_catalog_for_tests()


def test_golden_path_case_a_then_b(local_env):
    from app.ingest import IngestRequest, ingest
    from app.scan_plan import ScanPlanRequest, scan_plan
    from app.query import QueryRequest, execute_query
    import base64
    import pyarrow.ipc as ipc

    ingest(
        IngestRequest(
            staging_path=str(FIXTURES / "tidy_1k.csv"),
            dataset_id="golden",
            partition_hint="pickup_date",
            sort_column="fare_amount",
        )
    )

    plan_a = scan_plan(
        ScanPlanRequest(
            dataset_id="golden",
            filter="pickup_date = '2024-01-01'",
            columns=["fare_amount", "pickup_date"],
        )
    )
    assert plan_a.case == "A"
    assert plan_a.manifest is not None

    plan_b = scan_plan(
        ScanPlanRequest(dataset_id="golden", filter="fare_amount > 20")
    )
    assert plan_b.case == "B"

    result = execute_query(
        QueryRequest(
            dataset_id="golden",
            columns=["fare_amount"],
            filter="fare_amount > 20",
            query_hash="golden_b",
        )
    )
    assert result.row_count > 0
    if result.arrow_base64:
        table = ipc.open_stream(base64.b64decode(result.arrow_base64)).read_all()
        assert table.column_names == ["fare_amount"]
        assert all(v > 20 for v in table.column("fare_amount").to_pylist())
