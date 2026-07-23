"""Scan planning — Case A vs Case B verdict without reading data."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from pyiceberg.expressions import (
    And,
    EqualTo,
    GreaterThan,
    GreaterThanOrEqual,
    In,
    LessThan,
    LessThanOrEqual,
    NotEqualTo,
    BooleanExpression,
    AlwaysTrue,
)

from . import catalog as catalog_mod


@dataclass
class ScanPlanRequest:
    dataset_id: str
    namespace: str = "default"
    columns: Optional[list[str]] = None
    filter: Optional[str] = None
    snapshot: Optional[str] = None


@dataclass
class ScanPlanResult:
    case: str  # "A" or "B"
    matched_files: list[str]
    estimated_rows: int
    estimated_bytes: int
    manifest: Optional[dict[str, Any]]
    reason: str
    partition_columns: list[str]


# Simple predicate parser: col OP value [AND col OP value]*
# Supports =, !=, <, <=, >, >=, IN (...)
_PRED = re.compile(
    r"""
    (?P<col>[A-Za-z_][\w.]*)
    \s*
    (?P<op>=|!=|<>|<=|>=|<|>|IN)
    \s*
    (?P<val>
        '(?:[^']*)'
        | "(?:[^"]*)"
        | -?\d+(?:\.\d+)?
        | \([^)]+\)
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _parse_value(raw: str):
    raw = raw.strip()
    if raw.startswith("(") and raw.endswith(")"):
        inner = raw[1:-1]
        parts = [p.strip().strip("'\"") for p in inner.split(",")]
        out = []
        for p in parts:
            try:
                out.append(int(p) if "." not in p else float(p))
            except ValueError:
                out.append(p)
        return out
    if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
        return raw[1:-1]
    try:
        return int(raw) if "." not in raw else float(raw)
    except ValueError:
        return raw


def parse_filter_to_iceberg(filter_str: Optional[str]) -> tuple[Optional[BooleanExpression], list[str], bool]:
    """
    Returns (expression, referenced_columns, fully_parsed).
    fully_parsed=False means we couldn't represent the filter → Case B.
    """
    if not filter_str or not filter_str.strip():
        return AlwaysTrue(), [], True

    # Reject OR / complex nesting for Case A — those go to Case B
    upper = filter_str.upper()
    if " OR " in upper or "(" in filter_str:
        cols = re.findall(r"[A-Za-z_][\w.]*", filter_str)
        # remove keywords
        kw = {"AND", "OR", "NOT", "IN", "TRUE", "FALSE", "NULL"}
        cols = [c for c in cols if c.upper() not in kw]
        return None, cols, False

    exprs: list[BooleanExpression] = []
    cols: list[str] = []
    pos = 0
    s = filter_str.strip()
    while pos < len(s):
        # skip AND
        m_and = re.match(r"\s*AND\s+", s[pos:], re.IGNORECASE)
        if m_and and exprs:
            pos += m_and.end()
            continue
        m = _PRED.match(s, pos)
        if not m:
            cols = re.findall(r"[A-Za-z_][\w.]*", filter_str)
            return None, cols, False
        col = m.group("col")
        op = m.group("op").upper()
        val = _parse_value(m.group("val"))
        cols.append(col)
        if op == "=":
            exprs.append(EqualTo(col, val))
        elif op in ("!=", "<>"):
            exprs.append(NotEqualTo(col, val))
        elif op == "<":
            exprs.append(LessThan(col, val))
        elif op == "<=":
            exprs.append(LessThanOrEqual(col, val))
        elif op == ">":
            exprs.append(GreaterThan(col, val))
        elif op == ">=":
            exprs.append(GreaterThanOrEqual(col, val))
        elif op == "IN":
            exprs.append(In(col, val if isinstance(val, list) else [val]))
        else:
            return None, cols, False
        pos = m.end()

    if not exprs:
        return AlwaysTrue(), [], True
    expr: BooleanExpression = exprs[0]
    for e in exprs[1:]:
        expr = And(expr, e)
    return expr, cols, True


def _partition_cols(table) -> list[str]:
    spec = table.spec()
    if spec is None or len(spec.fields) == 0:
        return []
    schema = table.schema()
    names = []
    for pf in spec.fields:
        field = schema.find_field(pf.source_id)
        if field:
            names.append(field.name)
    return names


def scan_plan(req: ScanPlanRequest) -> ScanPlanResult:
    cat = catalog_mod.get_catalog()
    table_name = req.dataset_id.replace("-", "_")
    identifier = f"{req.namespace}.{table_name}"
    table = cat.load_table(identifier)
    part_cols = _partition_cols(table)

    expr, filter_cols, fully_parsed = parse_filter_to_iceberg(req.filter)
    snapshot_id = int(req.snapshot) if req.snapshot and req.snapshot.isdigit() else None

    selected = tuple(req.columns) if req.columns else ("*",)

    # Case B if filter not fully representable as Iceberg predicates
    if req.filter and not fully_parsed:
        return ScanPlanResult(
            case="B",
            matched_files=[],
            estimated_rows=0,
            estimated_bytes=0,
            manifest=None,
            reason="Filter not partition/stat-aligned (complex predicate) — requires compute",
            partition_columns=part_cols,
        )

    # Case B if any filter column is not a partition column (for MVP strict Case A)
    # Exception: empty filter + projection-only can still be Case A if whole files suffice
    non_partition_filters = [c for c in filter_cols if c not in part_cols]
    if non_partition_filters:
        return ScanPlanResult(
            case="B",
            matched_files=[],
            estimated_rows=0,
            estimated_bytes=0,
            manifest=None,
            reason=(
                f"Filter on non-partition column(s) {non_partition_filters}; "
                f"partition columns are {part_cols}. Adding a partition filter may hit Case A."
            ),
            partition_columns=part_cols,
        )

    tasks = cat.scan_plan(
        identifier,
        selected_fields=selected,
        row_filter=expr,
        snapshot_id=snapshot_id,
    )

    files: list[str] = []
    est_rows = 0
    est_bytes = 0
    entries: list[dict[str, Any]] = []

    for task in tasks:
        # FileScanTask attributes vary by pyiceberg version
        file_path = getattr(task, "file", None)
        if file_path is not None:
            path = getattr(file_path, "file_path", None) or str(file_path)
        else:
            path = str(getattr(task, "path", task))
        files.append(path)

        residual = getattr(task, "residual", None)
        # If residual filter remains after partition pruning → Case B
        if residual is not None and str(residual) not in ("true", "AlwaysTrue()", ""):
            return ScanPlanResult(
                case="B",
                matched_files=files,
                estimated_rows=0,
                estimated_bytes=0,
                manifest=None,
                reason="Scan plan has residual (non-partition) filter — requires compute",
                partition_columns=part_cols,
            )

        rg_offsets = []
        # Collect row-group byte ranges when available
        deletes = getattr(task, "delete_files", None) or []
        if deletes:
            return ScanPlanResult(
                case="B",
                matched_files=files,
                estimated_rows=0,
                estimated_bytes=0,
                manifest=None,
                reason="Position/equality deletes present — requires compute to apply",
                partition_columns=part_cols,
            )

        start = getattr(task, "start", 0) or 0
        length = getattr(task, "length", None)
        if length:
            rg_offsets.append([start, start + length - 1])
            est_bytes += length
        else:
            # whole file
            file_size = getattr(getattr(task, "file", None), "file_size_in_bytes", 0) or 0
            if file_size:
                rg_offsets.append([0, file_size - 1])
                est_bytes += file_size
            else:
                rg_offsets.append([0, -1])

        record_count = getattr(getattr(task, "file", None), "record_count", 0) or 0
        est_rows += record_count

        cols = list(req.columns) if req.columns else []
        entries.append(
            {
                "file": path,
                "ranges": rg_offsets,
                "columns": cols,
            }
        )

    # Projection-only on full table without partition filter is still Case A
    # if we can return whole existing files (no DuckDB needed to assemble).
    reason = (
        "Partition-aligned scan: returning existing file/row-group byte ranges (zero compute)"
        if filter_cols
        else "Projection over existing files (zero compute)"
    )

    return ScanPlanResult(
        case="A",
        matched_files=files,
        estimated_rows=est_rows,
        estimated_bytes=est_bytes,
        manifest={
            "entries": entries,
            "estimatedRows": est_rows,
            "estimatedBytes": est_bytes,
        },
        reason=reason,
        partition_columns=part_cols,
    )
