"""
Catalog interface — ALL Iceberg catalog access goes through this module.

MVP: PyIceberg SQL catalog (Postgres).
Phase 11.5: swap to REST catalog (Polaris/Nessie) via CATALOG_BACKEND=rest.
Branching methods are no-ops under the SQL backend.
"""

from __future__ import annotations

import os
import logging
from abc import ABC, abstractmethod
from typing import Any, Optional

from pyiceberg.catalog import load_catalog
from pyiceberg.schema import Schema
from pyiceberg.table import Table
from pyiceberg.expressions import AlwaysTrue, BooleanExpression
from pyiceberg.partitioning import PartitionSpec, PartitionField
from pyiceberg.transforms import IdentityTransform, DayTransform
from pyiceberg.types import NestedField

logger = logging.getLogger(__name__)


class CatalogBackend(ABC):
    @abstractmethod
    def create_table(
        self,
        identifier: str,
        schema: Schema,
        partition_spec: Optional[PartitionSpec] = None,
        properties: Optional[dict[str, str]] = None,
        location: Optional[str] = None,
    ) -> Table: ...

    @abstractmethod
    def load_table(self, identifier: str) -> Table: ...

    @abstractmethod
    def table_exists(self, identifier: str) -> bool: ...

    @abstractmethod
    def append(self, identifier: str, arrow_table: Any) -> Table: ...

    @abstractmethod
    def commit_snapshot(self, identifier: str) -> str:
        """Return current snapshot id after ensuring metadata is flushed."""
        ...

    @abstractmethod
    def scan_plan(
        self,
        identifier: str,
        selected_fields: Optional[tuple[str, ...]] = None,
        row_filter: Optional[BooleanExpression] = None,
        snapshot_id: Optional[int] = None,
    ) -> list[Any]: ...

    @abstractmethod
    def list_snapshots(self, identifier: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    def create_branch(self, identifier: str, branch: str, from_ref: str = "main") -> None: ...

    @abstractmethod
    def merge_branch(self, identifier: str, branch: str, into: str = "main") -> None: ...

    @abstractmethod
    def create_derived(
        self,
        identifier: str,
        schema: Schema,
        location: Optional[str] = None,
    ) -> Table:
        """Register a pointer derived dataset (schema only, no data files)."""
        ...


class SqlCatalogBackend(CatalogBackend):
    """PyIceberg SQL catalog backed by Postgres (or SQLite for local tests)."""

    def __init__(self) -> None:
        warehouse = os.environ.get("ICEBERG_WAREHOUSE", "s3://trainfabric-data/warehouse")
        catalog_uri = os.environ.get(
            "ICEBERG_CATALOG_URI",
            os.environ.get("DATABASE_URL", "sqlite:///tmp/iceberg_catalog.db"),
        )
        props: dict[str, str] = {
            "type": "sql",
            "uri": catalog_uri,
            "warehouse": warehouse,
            "s3.endpoint": os.environ.get("R2_ENDPOINT", os.environ.get("S3_ENDPOINT", "")),
            "s3.access-key-id": os.environ.get("R2_ACCESS_KEY_ID", os.environ.get("AWS_ACCESS_KEY_ID", "")),
            "s3.secret-access-key": os.environ.get(
                "R2_SECRET_ACCESS_KEY", os.environ.get("AWS_SECRET_ACCESS_KEY", "")
            ),
            "s3.region": os.environ.get("R2_REGION", "auto"),
            "s3.path-style-access": "true",
        }
        # Drop empty optional props
        props = {k: v for k, v in props.items() if v}
        self._catalog = load_catalog("trainfabric", **props)
        self._ensure_namespace("default")

    def _ensure_namespace(self, ns: str) -> None:
        try:
            self._catalog.create_namespace(ns)
        except Exception:
            pass  # already exists

    def _ident(self, identifier: str) -> tuple[str, ...]:
        parts = tuple(identifier.split("."))
        if len(parts) == 1:
            return ("default", parts[0])
        return parts

    def create_table(
        self,
        identifier: str,
        schema: Schema,
        partition_spec: Optional[PartitionSpec] = None,
        properties: Optional[dict[str, str]] = None,
        location: Optional[str] = None,
    ) -> Table:
        ident = self._ident(identifier)
        ns = ident[0]
        self._ensure_namespace(ns)
        kwargs: dict[str, Any] = {
            "schema": schema,
            "properties": properties or {"write.format.default": "parquet", "write.parquet.compression-codec": "zstd"},
        }
        if partition_spec is not None:
            kwargs["partition_spec"] = partition_spec
        if location:
            kwargs["location"] = location
        return self._catalog.create_table(ident, **kwargs)

    def load_table(self, identifier: str) -> Table:
        return self._catalog.load_table(self._ident(identifier))

    def table_exists(self, identifier: str) -> bool:
        return self._catalog.table_exists(self._ident(identifier))

    def append(self, identifier: str, arrow_table: Any) -> Table:
        table = self.load_table(identifier)
        table.append(arrow_table)
        return table

    def commit_snapshot(self, identifier: str) -> str:
        table = self.load_table(identifier)
        snap = table.current_snapshot()
        if snap is None:
            return "0"
        return str(snap.snapshot_id)

    def scan_plan(
        self,
        identifier: str,
        selected_fields: Optional[tuple[str, ...]] = None,
        row_filter: Optional[BooleanExpression] = None,
        snapshot_id: Optional[int] = None,
    ) -> list[Any]:
        table = self.load_table(identifier)
        scan = table.scan(
            row_filter=row_filter or AlwaysTrue(),
            selected_fields=selected_fields or ("*",),
            snapshot_id=snapshot_id,
        )
        return list(scan.plan_files())

    def list_snapshots(self, identifier: str) -> list[dict[str, Any]]:
        table = self.load_table(identifier)
        out: list[dict[str, Any]] = []
        for snap in table.snapshots():
            out.append(
                {
                    "snapshotId": str(snap.snapshot_id),
                    "parentSnapshotId": str(snap.parent_snapshot_id) if snap.parent_snapshot_id else None,
                    "timestampMs": snap.timestamp_ms,
                    "summary": dict(snap.summary) if snap.summary else {},
                }
            )
        return out

    def create_branch(self, identifier: str, branch: str, from_ref: str = "main") -> None:
        # No-op under SQL catalog MVP — branching enabled in REST backend (§11.5)
        logger.info("create_branch no-op (SQL catalog): %s %s from %s", identifier, branch, from_ref)

    def merge_branch(self, identifier: str, branch: str, into: str = "main") -> None:
        logger.info("merge_branch no-op (SQL catalog): %s %s into %s", identifier, branch, into)

    def create_derived(
        self,
        identifier: str,
        schema: Schema,
        location: Optional[str] = None,
    ) -> Table:
        """Pointer derived: empty table registering schema only."""
        return self.create_table(
            identifier,
            schema,
            properties={
                "write.format.default": "parquet",
                "trainfabric.kind": "derived-pointer",
            },
            location=location,
        )


class RestCatalogBackend(CatalogBackend):
    """
    Iceberg REST catalog (Polaris/Nessie) — used when ENABLE_BRANCHING=true.
    Shares the same interface; branching methods are live.
    """

    def __init__(self) -> None:
        uri = os.environ.get("ICEBERG_REST_URI", "http://localhost:8181/api/catalog")
        # R2 Data Catalog expects warehouse id like "<account>_<bucket>"
        warehouse = os.environ.get(
            "ICEBERG_WAREHOUSE_ID",
            os.environ.get("ICEBERG_WAREHOUSE", "s3://trainfabric-data/warehouse"),
        )
        token = os.environ.get("ICEBERG_TOKEN", os.environ.get("R2_CATALOG_TOKEN", ""))
        props: dict[str, str] = {
            "type": "rest",
            "uri": uri,
            "warehouse": warehouse,
            "token": token,
            "s3.endpoint": os.environ.get("R2_ENDPOINT", ""),
            "s3.access-key-id": os.environ.get("R2_ACCESS_KEY_ID", ""),
            "s3.secret-access-key": os.environ.get("R2_SECRET_ACCESS_KEY", ""),
            "s3.region": os.environ.get("R2_REGION", "auto"),
            "s3.path-style-access": "true",
        }
        props = {k: v for k, v in props.items() if v}
        self._catalog = load_catalog("trainfabric-rest", **props)
        self._ensure_namespace("default")

    def _ensure_namespace(self, ns: str) -> None:
        try:
            self._catalog.create_namespace(ns)
        except Exception:
            pass

    def create_table(
        self,
        identifier: str,
        schema: Schema,
        partition_spec: Optional[PartitionSpec] = None,
        properties: Optional[dict[str, str]] = None,
        location: Optional[str] = None,
    ) -> Table:
        kwargs: dict[str, Any] = {"schema": schema, "properties": properties or {}}
        if partition_spec is not None:
            kwargs["partition_spec"] = partition_spec
        if location:
            kwargs["location"] = location
        return self._catalog.create_table(identifier, **kwargs)

    def load_table(self, identifier: str) -> Table:
        return self._catalog.load_table(identifier)

    def table_exists(self, identifier: str) -> bool:
        return self._catalog.table_exists(identifier)

    def append(self, identifier: str, arrow_table: Any) -> Table:
        table = self.load_table(identifier)
        table.append(arrow_table)
        return table

    def commit_snapshot(self, identifier: str) -> str:
        table = self.load_table(identifier)
        snap = table.current_snapshot()
        return str(snap.snapshot_id) if snap else "0"

    def scan_plan(
        self,
        identifier: str,
        selected_fields: Optional[tuple[str, ...]] = None,
        row_filter: Optional[BooleanExpression] = None,
        snapshot_id: Optional[int] = None,
    ) -> list[Any]:
        table = self.load_table(identifier)
        scan = table.scan(
            row_filter=row_filter or AlwaysTrue(),
            selected_fields=selected_fields or ("*",),
            snapshot_id=snapshot_id,
        )
        return list(scan.plan_files())

    def list_snapshots(self, identifier: str) -> list[dict[str, Any]]:
        table = self.load_table(identifier)
        return [
            {
                "snapshotId": str(s.snapshot_id),
                "parentSnapshotId": str(s.parent_snapshot_id) if s.parent_snapshot_id else None,
                "timestampMs": s.timestamp_ms,
                "summary": dict(s.summary) if s.summary else {},
            }
            for s in table.snapshots()
        ]

    def create_branch(self, identifier: str, branch: str, from_ref: str = "main") -> None:
        table = self.load_table(identifier)
        # PyIceberg REST refs API
        if hasattr(table, "manage_snapshots"):
            with table.manage_snapshots() as ms:
                ms.create_branch(branch, from_ref)
        else:
            raise NotImplementedError("REST catalog does not support manage_snapshots in this pyiceberg version")

    def merge_branch(self, identifier: str, branch: str, into: str = "main") -> None:
        # Fast-forward style merge: set into ref to branch tip
        table = self.load_table(identifier)
        if hasattr(table, "manage_snapshots"):
            refs = table.refs()
            branch_ref = refs.get(branch)
            if branch_ref is None:
                raise ValueError(f"Branch {branch} not found")
            with table.manage_snapshots() as ms:
                ms.set_ref(into, branch_ref.snapshot_id)
        else:
            raise NotImplementedError("merge_branch unavailable")

    def create_derived(
        self,
        identifier: str,
        schema: Schema,
        location: Optional[str] = None,
    ) -> Table:
        return self.create_table(
            identifier,
            schema,
            properties={"trainfabric.kind": "derived-pointer"},
            location=location,
        )


_backend: Optional[CatalogBackend] = None


def get_catalog() -> CatalogBackend:
    global _backend
    if _backend is None:
        enable = os.environ.get("ENABLE_BRANCHING", "false").lower() in ("1", "true", "yes")
        backend = os.environ.get("CATALOG_BACKEND", "rest" if enable else "sql").lower()
        if backend == "rest":
            _backend = RestCatalogBackend()
        else:
            _backend = SqlCatalogBackend()
    return _backend


def reset_catalog_for_tests() -> None:
    """Clear singleton so tests can reconfigure env."""
    global _backend
    _backend = None


# Re-exports for callers that only import catalog helpers
__all__ = [
    "CatalogBackend",
    "SqlCatalogBackend",
    "RestCatalogBackend",
    "get_catalog",
    "reset_catalog_for_tests",
    "PartitionSpec",
    "PartitionField",
    "IdentityTransform",
    "DayTransform",
    "Schema",
    "NestedField",
]
