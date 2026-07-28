"""Hermes DuckDB tools — prefer `tf` CLI (platform surface) when auth present.

On Box / golden images, only the `tf` path is available (no local Iceberg catalog).
In-process catalog/query is a compute-container fallback via lazy imports.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from typing import Any, Optional

from .cli_auth import get_cli_auth

logger = logging.getLogger("compute.hermes.tools")


def _identifier(dataset_id: str, namespace: str) -> str:
    return f"{namespace}.{dataset_id.replace('-', '_')}"


def _rest_dataset_id(dataset_id: str) -> str:
    """Prefer public ds_ id from auth context for REST paths."""
    ctx = get_cli_auth()
    if ctx and ctx.public_dataset_id:
        return ctx.public_dataset_id
    return dataset_id


def _tf_env() -> Optional[dict[str, str]]:
    ctx = get_cli_auth()
    if not ctx or not ctx.auth_token or not ctx.api_base:
        return None
    env = {**os.environ, "TRAINFABRIC_API_URL": ctx.api_base, "TRAINFABRIC_TOKEN": ctx.auth_token}
    if ctx.public_dataset_id:
        env["TRAINFABRIC_DATASET_ID"] = ctx.public_dataset_id
    return env


def _run_tf(args: list[str]) -> Optional[dict[str, Any]]:
    env = _tf_env()
    if env is None:
        return None
    try:
        proc = subprocess.run(
            ["tf", *args],
            capture_output=True,
            text=True,
            env=env,
            timeout=180,
            check=False,
        )
    except FileNotFoundError:
        logger.warning("tf binary not found — falling back to in-process tools")
        return None
    except Exception as e:
        logger.warning("tf failed: %s", e)
        return {"error": str(e), "via": "tf"}
    raw = (proc.stdout or "").strip() or (proc.stderr or "").strip()
    try:
        data = json.loads(raw) if raw else {"error": "empty tf output"}
    except json.JSONDecodeError:
        data = {"error": raw[:2000] or f"tf exit {proc.returncode}"}
    if proc.returncode != 0 and isinstance(data, dict):
        data.setdefault("error", f"tf exit {proc.returncode}")
        data["via"] = "tf"
        return data
    if isinstance(data, dict):
        data["via"] = "tf"
    return data if isinstance(data, dict) else {"result": data, "via": "tf"}


def _schema_inprocess(dataset_id: str, namespace: str = "default") -> dict[str, Any]:
    try:
        from .. import catalog as catalog_mod
        from ..query import sample as sample_rows_fn
    except ImportError:  # pragma: no cover - Box golden without compute catalog
        return {
            "error": "in-process catalog unavailable — set TRAINFABRIC_TOKEN and use tf CLI",
            "via": "inprocess",
        }

    try:
        cat = catalog_mod.get_catalog()
        ident = _identifier(dataset_id, namespace)
        table = cat.load_table(ident)
        schema = table.schema()
    except Exception as e:
        return {"error": str(e), "via": "inprocess"}

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
        "via": "inprocess",
    }


def get_schema(dataset_id: str, namespace: str = "default") -> dict[str, Any]:
    tf = _run_tf(["schema", _rest_dataset_id(dataset_id)])
    if tf is not None and "error" not in tf:
        # Normalize REST SchemaContract → Hermes shape when needed
        if "columns" in tf and "partitionColumns" not in tf:
            parts = []
            cols = []
            for c in tf.get("columns") or []:
                if isinstance(c, dict):
                    name = c.get("name") or c.get("column")
                    cols.append(
                        {
                            "name": name,
                            "type": str(c.get("type") or c.get("dataType") or ""),
                            "required": bool(c.get("required", False)),
                            "isPartition": bool(c.get("isPartition") or c.get("partition")),
                        }
                    )
                    if c.get("isPartition") or c.get("partition"):
                        parts.append(name)
            tf = {
                "dataset_id": _rest_dataset_id(dataset_id),
                "namespace": namespace,
                "columns": cols or tf.get("columns"),
                "partitionColumns": tf.get("partitionColumns") or parts,
                "sampleRows": tf.get("sampleRows") or [],
                "hint": tf.get("hint"),
                "via": "tf",
                "raw": tf,
            }
        return tf
    return _schema_inprocess(dataset_id, namespace)


def estimate_query(
    dataset_id: str,
    *,
    columns: Optional[list[str]] = None,
    filter: Optional[str] = None,
    snapshot: Optional[str] = None,
    namespace: str = "default",
) -> dict[str, Any]:
    args = ["estimate", _rest_dataset_id(dataset_id)]
    if columns:
        args += ["--columns", ",".join(columns)]
    if filter:
        args += ["--filter", filter]
    tf = _run_tf(args)
    if tf is not None and "error" not in tf:
        # Map costTier → case for Hermes skill compatibility
        tier = tf.get("costTier") or tf.get("case")
        if tier and "case" not in tf:
            tf = {**tf, "case": "A" if tier == "A" else ("B" if tier == "B" else tier)}
        return tf

    try:
        from ..scan_plan import ScanPlanRequest, scan_plan
    except ImportError:  # pragma: no cover - Box golden without compute catalog
        return {
            "error": "in-process scan_plan unavailable — set TRAINFABRIC_TOKEN and use tf CLI",
            "via": "inprocess",
        }

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
        "via": "inprocess",
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
    args = ["query", _rest_dataset_id(dataset_id), "--limit", str(limit or 1000)]
    if columns:
        args += ["--columns", ",".join(columns)]
    if filter:
        args += ["--filter", filter]
    tf = _run_tf(args)
    if tf is not None:
        return tf

    try:
        from ..query import QueryRequest, execute_query
    except ImportError:  # pragma: no cover - Box golden without compute catalog
        return {
            "error": "in-process query unavailable — set TRAINFABRIC_TOKEN and use tf CLI",
            "columns": columns,
            "filter": filter,
            "limit": limit,
            "via": "inprocess",
        }

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
            "via": "inprocess",
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
        "via": "inprocess",
    }


def sample_rows(dataset_id: str, n: int = 5, namespace: str = "default") -> dict[str, Any]:
    tf = _run_tf(["sample", _rest_dataset_id(dataset_id), "-n", str(n)])
    if tf is not None and "error" not in tf:
        return tf
    try:
        from ..query import sample as sample_rows_fn
    except ImportError:  # pragma: no cover - Box golden without compute catalog
        return {
            "error": "in-process sample unavailable — set TRAINFABRIC_TOKEN and use tf CLI",
            "via": "inprocess",
        }
    try:
        return {"rows": sample_rows_fn(dataset_id, n, namespace), "via": "inprocess"}
    except Exception as e:
        return {"error": str(e), "via": "inprocess"}


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
        return sample_rows(dataset_id, n, namespace)
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
