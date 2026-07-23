"""Case B query execution via DuckDB against Iceberg/Parquet on R2."""

from __future__ import annotations

import base64
import io
import os
from dataclasses import dataclass
from typing import Any, Optional

import pyarrow as pa
import pyarrow.ipc as ipc

from . import catalog as catalog_mod
from .duckconf import open_connection


STREAM_THRESHOLD = int(os.environ.get("STREAM_SIZE_THRESHOLD_BYTES", str(50 * 1024 * 1024)))
MAX_ROWS = int(os.environ.get("MAX_RESULT_ROWS", str(10_000_000)))


@dataclass
class QueryRequest:
    dataset_id: str
    namespace: str = "default"
    columns: Optional[list[str]] = None
    filter: Optional[str] = None
    snapshot: Optional[str] = None
    limit: Optional[int] = None
    query_hash: Optional[str] = None
    force_link: bool = False


@dataclass
class QueryResult:
    mode: str  # stream | link
    arrow_base64: Optional[str]
    r2_path: Optional[str]
    row_count: int
    size_bytes: int


def _table_paths(identifier: str, snapshot: Optional[str] = None) -> list[str]:
    cat = catalog_mod.get_catalog()
    snapshot_id = int(snapshot) if snapshot and str(snapshot).isdigit() else None
    tasks = cat.scan_plan(identifier, snapshot_id=snapshot_id)
    paths = []
    for task in tasks:
        file_path = getattr(task, "file", None)
        if file_path is not None:
            path = getattr(file_path, "file_path", None) or str(file_path)
        else:
            path = str(getattr(task, "path", task))
        paths.append(path.replace("r2://", "s3://"))
    return paths


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def execute_query(req: QueryRequest) -> QueryResult:
    table_name = req.dataset_id.replace("-", "_")
    identifier = f"{req.namespace}.{table_name}"
    paths = _table_paths(identifier, req.snapshot)
    if not paths:
        empty = pa.table({})
        return _pack_result(empty, req)

    con = open_connection()
    # Build a union view over parquet files
    path_list = ", ".join(f"'{p}'" for p in paths)
    cols = "*"
    if req.columns:
        cols = ", ".join(_quote_ident(c) for c in req.columns)

    where = ""
    if req.filter:
        # Filter already validated by router; bind as literal SQL predicate
        where = f" WHERE ({req.filter})"

    limit = ""
    lim = req.limit if req.limit is not None else MAX_ROWS
    lim = min(lim, MAX_ROWS)
    limit = f" LIMIT {int(lim)}"

    sql = f"SELECT {cols} FROM read_parquet([{path_list}], union_by_name=true){where}{limit}"
    arrow_obj = con.execute(sql).arrow()
    if isinstance(arrow_obj, pa.Table):
        arrow = arrow_obj
    elif hasattr(arrow_obj, "read_all"):
        arrow = arrow_obj.read_all()
    else:
        raise TypeError(f"Unexpected DuckDB arrow type: {type(arrow_obj)}")
    return _pack_result(arrow, req)


def _pack_result(arrow: pa.Table, req: QueryRequest) -> QueryResult:
    # Serialize to IPC to measure size
    sink = pa.BufferOutputStream()
    with ipc.new_stream(sink, arrow.schema) as writer:
        writer.write_table(arrow)
    buf = sink.getvalue().to_pybytes()
    size = len(buf)

    if not req.force_link and size <= STREAM_THRESHOLD:
        return QueryResult(
            mode="stream",
            arrow_base64=base64.b64encode(buf).decode("ascii"),
            r2_path=None,
            row_count=arrow.num_rows,
            size_bytes=size,
        )

    # Write result parquet to R2 via DuckDB COPY (streamed, no local staging)
    qh = req.query_hash or "anon"
    bucket = os.environ.get("R2_BUCKET", "trainfabric-data")
    r2_path = f"s3://{bucket}/results/{qh}.parquet"
    con = open_connection()
    con.register("result_view", arrow)
    con.execute(f"COPY result_view TO '{r2_path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    return QueryResult(
        mode="link",
        arrow_base64=None,
        r2_path=r2_path,
        row_count=arrow.num_rows,
        size_bytes=size,
    )


def sample(dataset_id: str, n: int = 20, namespace: str = "default") -> list[dict[str, Any]]:
    result = execute_query(
        QueryRequest(dataset_id=dataset_id, namespace=namespace, limit=n)
    )
    if result.arrow_base64:
        raw = base64.b64decode(result.arrow_base64)
        reader = ipc.open_stream(raw)
        table = reader.read_all()
        rows = table.to_pylist()
        return [
            {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()}
            for r in rows
        ]
    return []
