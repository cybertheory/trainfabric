"""Hermes DuckDB tools backed by Trainfabric catalog / scan_plan / query."""

from __future__ import annotations

from typing import Any, Optional

from .. import catalog as catalog_mod
from ..query import QueryRequest, execute_query, sample as sample_rows_fn
from ..scan_plan import ScanPlanRequest, scan_plan


def _identifier(dataset_id: str, namespace: str) -> str:
    return f"{namespace}.{dataset_id.replace('-', '_')}"


def get_schema(dataset_id: str, namespace: str = "default") -> dict[str, Any]:
    cat = catalog_mod.get_catalog()
    ident = _identifier(dataset_id, namespace)
    table = cat.load_table(ident)
    schema = table.schema()
    partition_names: list[str] = []
    try:
        spec = table.spec()
        for field in getattr(spec, "fields", []) or []:
            src = schema.find_field(field.source_id)
            if src is not None:
                partition_names.append(src.name)
    except Exception:
        partition_names = []

    columns = []
    for field in schema.fields:
        columns.append(
            {
                "name": field.name,
                "type": str(field.field_type),
                "required": field.required,
                "isPartition": field.name in partition_names,
            }
        )

    # Cheap sample for grounding
    rows: list[dict[str, Any]] = []
    try:
        rows = sample_rows_fn(dataset_id, 3, namespace)
    except Exception:
        rows = []

    return {
        "dataset_id": dataset_id,
        "namespace": namespace,
        "columns": columns,
        "partitionColumns": partition_names,
        "sampleRows": rows,
        "hint": (
            f"Filtering on {', '.join(partition_names)} is cheap (Case A)."
            if partition_names
            else "No partition columns — filters are Case B (compute)."
        ),
    }


def estimate_query(
    dataset_id: str,
    *,
    columns: Optional[list[str]] = None,
    filter: Optional[str] = None,
    snapshot: Optional[str] = None,
    namespace: str = "default",
) -> dict[str, Any]:
    plan = scan_plan(
        ScanPlanRequest(
            dataset_id=dataset_id,
            namespace=namespace,
            columns=columns,
            filter=filter,
            snapshot=snapshot,
        )
    )
    return {
        "case": plan.case,
        "estimatedRows": plan.estimated_rows,
        "estimatedBytes": plan.estimated_bytes,
        "reason": plan.reason,
        "partitionColumns": plan.partition_columns,
        "matchedFiles": plan.matched_files[:20],
    }


def run_query(
    dataset_id: str,
    *,
    columns: Optional[list[str]] = None,
    filter: Optional[str] = None,
    snapshot: Optional[str] = None,
    limit: Optional[int] = 1000,
    namespace: str = "default",
) -> dict[str, Any]:
    try:
        result = execute_query(
            QueryRequest(
                dataset_id=dataset_id,
                namespace=namespace,
                columns=columns,
                filter=filter,
                snapshot=snapshot,
                limit=limit,
            )
        )
    except Exception as e:
        return {
            "error": str(e),
            "columns": columns,
            "filter": filter,
            "limit": limit,
        }
    return {
        "mode": result.mode,
        "arrowBase64": result.arrow_base64,
        "r2Path": result.r2_path,
        "rowCount": result.row_count,
        "sizeBytes": result.size_bytes,
        "columns": columns,
        "filter": filter,
        "limit": limit,
    }


# Keep schemas Workers-AI friendly: avoid additionalProperties / union types.
TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_schema",
            "description": "Load dataset schema, partition columns, and sample rows.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "estimate_query",
            "description": "Estimate Case A/B cost for columns + filter before running.",
            "parameters": {
                "type": "object",
                "properties": {
                    "columns": {"type": "array", "items": {"type": "string"}},
                    "filter": {"type": "string"},
                    "snapshot": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sample_rows",
            "description": "Peek at N sample rows without a full slice query.",
            "parameters": {
                "type": "object",
                "properties": {"n": {"type": "integer"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_query",
            "description": "Execute a DuckDB/Iceberg slice (columns + filter + limit).",
            "parameters": {
                "type": "object",
                "properties": {
                    "columns": {"type": "array", "items": {"type": "string"}},
                    "filter": {"type": "string"},
                    "limit": {"type": "integer"},
                    "snapshot": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "Return the final NL→slice plan (and optional execution summary).",
            "parameters": {
                "type": "object",
                "properties": {
                    "columns": {"type": "array", "items": {"type": "string"}},
                    "filter": {"type": "string"},
                    "limit": {"type": "integer"},
                    "sql": {"type": "string"},
                    "estimate": {"type": "object"},
                    "explanation": {"type": "string"},
                    "executed": {"type": "boolean"},
                },
                "required": ["columns", "explanation"],
            },
        },
    },
]


def dispatch_tool(
    name: str,
    args: dict[str, Any],
    *,
    dataset_id: str,
    namespace: str,
    allow_execute: bool,
) -> Any:
    if name == "get_schema":
        return get_schema(dataset_id, namespace)
    if name == "estimate_query":
        return estimate_query(
            dataset_id,
            columns=args.get("columns"),
            filter=args.get("filter"),
            snapshot=args.get("snapshot"),
            namespace=namespace,
        )
    if name == "sample_rows":
        n = int(args.get("n") or 5)
        return {"rows": sample_rows_fn(dataset_id, n, namespace)}
    if name == "run_query":
        if not allow_execute:
            return {"error": "execute=false; call finish with the plan instead of run_query"}
        return run_query(
            dataset_id,
            columns=args.get("columns"),
            filter=args.get("filter"),
            snapshot=args.get("snapshot"),
            limit=args.get("limit"),
            namespace=namespace,
        )
    if name == "finish":
        return {"__finish__": True, **args}
    return {"error": f"unknown tool: {name}"}
