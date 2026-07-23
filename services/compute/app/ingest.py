"""Ingest staged files into Iceberg tables on R2."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Optional

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from . import catalog as catalog_mod
from .duckconf import open_connection
from .schema_util import (
    arrow_to_iceberg_schema,
    compute_column_stats,
    detect_partition_column,
    sample_rows,
)


TARGET_FILE_BYTES = 128 * 1024 * 1024
MAX_PARTITIONS = 256


@dataclass
class IngestRequest:
    staging_path: str
    dataset_id: str
    partition_hint: Optional[str] = None
    sort_column: Optional[str] = None
    descriptions: dict[str, str] = field(default_factory=dict)
    namespace: str = "default"


@dataclass
class IngestResult:
    schema_contract: dict[str, Any]
    snapshot_id: str
    iceberg_table: str
    namespace: str


def _as_table(obj: Any) -> pa.Table:
    """DuckDB .arrow() may return a RecordBatchReader; normalize to Table."""
    if isinstance(obj, pa.Table):
        return obj
    if hasattr(obj, "read_all"):
        return obj.read_all()
    if isinstance(obj, pa.RecordBatch):
        return pa.Table.from_batches([obj])
    raise TypeError(f"Expected Arrow table-like, got {type(obj)}")


def _read_staged(path: str) -> pa.Table:
    con = open_connection()
    lower = path.lower()
    uri = path.replace("r2://", "s3://")
    if lower.endswith(".parquet") or lower.endswith(".parq"):
        if path.startswith("s3://") or path.startswith("r2://") or path.startswith("http"):
            return _as_table(con.execute(f"SELECT * FROM read_parquet('{uri}')").arrow())
        return pq.read_table(path)
    if lower.endswith(".json") or lower.endswith(".jsonl") or lower.endswith(".ndjson"):
        return _as_table(con.execute(f"SELECT * FROM read_json_auto('{uri}')").arrow())
    return _as_table(
        con.execute(
            f"SELECT * FROM read_csv_auto('{uri}', HEADER=true, SAMPLE_SIZE=-1)"
        ).arrow()
    )


def _sort_table(table: pa.Table, sort_column: Optional[str]) -> pa.Table:
    if not sort_column or sort_column not in table.column_names:
        return table
    indices = pc.sort_indices(table, sort_keys=[(sort_column, "ascending")])
    return table.take(indices)


def _build_partition_spec(schema, partition_col: Optional[str], arrow_table: pa.Table):
    from pyiceberg.partitioning import PartitionSpec, PartitionField
    from pyiceberg.transforms import IdentityTransform, DayTransform

    if not partition_col:
        return PartitionSpec()

    try:
        nunique = pc.count_distinct(arrow_table.column(partition_col)).as_py()
    except Exception:
        nunique = 1
    if nunique and nunique > MAX_PARTITIONS:
        return PartitionSpec()

    field = next((f for f in schema.fields if f.name == partition_col), None)
    if field is None:
        return PartitionSpec()

    # Always identity for MVP — DayTransform requires optional pyiceberg-core native wheel.
    transform = IdentityTransform()
    part_name = f"{partition_col}_part"
    return PartitionSpec(
        PartitionField(
            source_id=field.field_id,
            field_id=1000,
            transform=transform,
            name=part_name,
        )
    )


def ingest(req: IngestRequest) -> IngestResult:
    arrow = _read_staged(req.staging_path)
    partition_col = req.partition_hint or detect_partition_column(arrow)
    sort_col = req.sort_column or partition_col
    arrow = _sort_table(arrow, sort_col)

    ice_schema = arrow_to_iceberg_schema(arrow.schema)
    part_spec = _build_partition_spec(ice_schema, partition_col, arrow)

    cat = catalog_mod.get_catalog()
    table_name = req.dataset_id.replace("-", "_")
    identifier = f"{req.namespace}.{table_name}"

    # R2 Data Catalog requires locations under s3://<bucket>/__r2_data_catalog/
    # Omit location for REST so the catalog assigns a valid profile path.
    location = None
    if os.environ.get("CATALOG_BACKEND", "sql") != "rest":
        warehouse = os.environ.get("ICEBERG_WAREHOUSE", "s3://trainfabric-data/__r2_data_catalog")
        location = f"{warehouse.rstrip('/')}/{req.namespace}/{table_name}"

    if cat.table_exists(identifier):
        cat.append(identifier, arrow)
    else:
        cat.create_table(
            identifier,
            ice_schema,
            partition_spec=part_spec,
            location=location,
            properties={
                "write.format.default": "parquet",
                "write.parquet.compression-codec": "zstd",
                "write.target-file-size-bytes": str(TARGET_FILE_BYTES),
                "write.parquet.row-group-size-bytes": str(128 * 1024 * 1024),
            },
        )
        cat.append(identifier, arrow)

    snapshot_id = cat.commit_snapshot(identifier)
    stats = compute_column_stats(arrow, partition_col)
    for name, desc in req.descriptions.items():
        if name in stats:
            stats[name]["description"] = desc

    columns = []
    for name in arrow.column_names:
        s = stats.get(name, {})
        columns.append(
            {
                "name": name,
                "type": s.get("type", str(arrow.schema.field(name).type)),
                "nullable": arrow.schema.field(name).nullable,
                "nullRate": s.get("nullRate"),
                "distinctCount": s.get("distinctCount"),
                "min": s.get("min"),
                "max": s.get("max"),
                "isPartition": name == partition_col,
                "description": s.get("description"),
            }
        )

    size_bytes = sum(arrow.column(i).nbytes for i in range(arrow.num_columns))

    schema_contract = {
        "datasetId": req.dataset_id,
        "snapshotId": snapshot_id,
        "columns": columns,
        "rowCount": arrow.num_rows,
        "sizeBytes": size_bytes,
        "partitionColumns": [partition_col] if partition_col else [],
        "sampleRows": sample_rows(arrow, n=20),
    }

    return IngestResult(
        schema_contract=schema_contract,
        snapshot_id=snapshot_id,
        iceberg_table=table_name,
        namespace=req.namespace,
    )
