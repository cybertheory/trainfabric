"""Arrow ↔ Iceberg schema helpers and column stats."""

from __future__ import annotations

from typing import Any, Optional

import pyarrow as pa
import pyarrow.compute as pc
from pyiceberg.schema import Schema
from pyiceberg.types import (
    BooleanType,
    DateType,
    DoubleType,
    FloatType,
    IntegerType,
    LongType,
    NestedField,
    StringType,
    TimestampType,
    TimestamptzType,
)


def _arrow_type_to_iceberg(t: pa.DataType):
    if pa.types.is_boolean(t):
        return BooleanType()
    if pa.types.is_int8(t) or pa.types.is_int16(t) or pa.types.is_int32(t):
        return IntegerType()
    if pa.types.is_int64(t) or pa.types.is_uint32(t) or pa.types.is_uint64(t):
        return LongType()
    if pa.types.is_float32(t):
        return FloatType()
    if pa.types.is_float64(t):
        return DoubleType()
    if pa.types.is_date(t):
        return DateType()
    if pa.types.is_timestamp(t):
        if t.tz:
            return TimestamptzType()
        return TimestampType()
    if pa.types.is_string(t) or pa.types.is_large_string(t):
        return StringType()
    return StringType()


def arrow_to_iceberg_schema(arrow_schema: pa.Schema) -> Schema:
    fields = []
    for i, field in enumerate(arrow_schema, start=1):
        fields.append(
            NestedField(
                field_id=i,
                name=field.name,
                field_type=_arrow_type_to_iceberg(field.type),
                required=not field.nullable,
            )
        )
    return Schema(*fields)


def iceberg_type_name(t: pa.DataType) -> str:
    if pa.types.is_boolean(t):
        return "boolean"
    if pa.types.is_integer(t):
        return "long" if pa.types.is_int64(t) else "int"
    if pa.types.is_floating(t):
        return "double" if pa.types.is_float64(t) else "float"
    if pa.types.is_date(t):
        return "date"
    if pa.types.is_timestamp(t):
        return "timestamp"
    return "string"


DATE_LIKE = ("date", "dt", "day", "ts", "time", "timestamp", "created", "pickup", "dropoff")
LOW_CARD_HINTS = ("region", "country", "vendor", "category", "device", "status", "type")


def detect_partition_column(table: pa.Table) -> Optional[str]:
    n = table.num_rows or 1
    candidates: list[tuple[float, str]] = []
    for name in table.column_names:
        col = table.column(name)
        lower = name.lower()
        try:
            distinct = pc.count_distinct(col).as_py() or 1
        except Exception:
            continue
        cardinality = distinct / n
        score = 0.0
        if any(h in lower for h in DATE_LIKE):
            score += 2.0
        if any(h in lower for h in LOW_CARD_HINTS):
            score += 1.5
        if 0.001 < cardinality < 0.05 or (distinct <= 64 and distinct > 1):
            score += 1.0
        elif distinct > 256:
            score -= 2.0
        if score > 0:
            candidates.append((score, name))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


def _scalar_py(v: Any) -> Any:
    if v is None:
        return None
    if hasattr(v, "as_py"):
        return v.as_py()
    return v


def compute_column_stats(table: pa.Table, partition_col: Optional[str] = None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    n = table.num_rows or 1
    for name in table.column_names:
        col = table.column(name)
        nulls = pc.sum(pc.is_null(col)).as_py() or 0
        try:
            distinct = pc.count_distinct(col).as_py()
        except Exception:
            distinct = None
        mn = mx = None
        try:
            mn = _scalar_py(pc.min(col))
            mx = _scalar_py(pc.max(col))
            if hasattr(mn, "isoformat"):
                mn = mn.isoformat()
            if hasattr(mx, "isoformat"):
                mx = mx.isoformat()
        except Exception:
            pass
        out[name] = {
            "type": iceberg_type_name(table.schema.field(name).type),
            "nullRate": nulls / n,
            "distinctCount": distinct,
            "min": mn,
            "max": mx,
            "isPartition": name == partition_col,
        }
    return out


def sample_rows(table: pa.Table, n: int = 20) -> list[dict[str, Any]]:
    k = min(n, table.num_rows)
    if k == 0:
        return []
    subset = table.slice(0, k)
    rows = subset.to_pylist()
    cleaned = []
    for r in rows:
        cleaned.append({k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()})
    return cleaned
