"""Compute container HTTP API — called by the Worker only."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .ingest import IngestRequest, ingest
from .scan_plan import ScanPlanRequest, scan_plan
from .query import QueryRequest, execute_query, sample
from . import catalog as catalog_mod

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("compute")

app = FastAPI(title="trainfabric-compute", version="0.1.0")


class IngestBody(BaseModel):
    staging_path: str
    dataset_id: str
    partition_hint: Optional[str] = None
    sort_column: Optional[str] = None
    descriptions: dict[str, str] = Field(default_factory=dict)
    namespace: str = "default"


class QueryBody(BaseModel):
    dataset_id: str
    namespace: str = "default"
    columns: Optional[list[str]] = None
    filter: Optional[str] = None
    snapshot: Optional[str] = None
    limit: Optional[int] = None
    query_hash: Optional[str] = None
    mode: Optional[str] = None
    force_link: bool = False


class SampleBody(BaseModel):
    dataset_id: str
    n: int = 20
    namespace: str = "default"


class BranchBody(BaseModel):
    dataset_id: str
    branch: str
    from_ref: str = "main"
    namespace: str = "default"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ingest")
def post_ingest(body: IngestBody) -> dict[str, Any]:
    try:
        result = ingest(
            IngestRequest(
                staging_path=body.staging_path,
                dataset_id=body.dataset_id,
                partition_hint=body.partition_hint,
                sort_column=body.sort_column,
                descriptions=body.descriptions,
                namespace=body.namespace,
            )
        )
        return {
            "schemaContract": result.schema_contract,
            "snapshotId": result.snapshot_id,
            "icebergTable": result.iceberg_table,
            "namespace": result.namespace,
        }
    except Exception as e:
        logger.exception("ingest failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/scan-plan")
def post_scan_plan(body: QueryBody) -> dict[str, Any]:
    try:
        result = scan_plan(
            ScanPlanRequest(
                dataset_id=body.dataset_id,
                namespace=body.namespace,
                columns=body.columns,
                filter=body.filter,
                snapshot=body.snapshot,
            )
        )
        return {
            "case": result.case,
            "matchedFiles": result.matched_files,
            "estimatedRows": result.estimated_rows,
            "estimatedBytes": result.estimated_bytes,
            "manifest": result.manifest,
            "reason": result.reason,
            "partitionColumns": result.partition_columns,
        }
    except Exception as e:
        logger.exception("scan-plan failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/query")
def post_query(body: QueryBody) -> dict[str, Any]:
    try:
        force_link = body.force_link or body.mode == "link"
        result = execute_query(
            QueryRequest(
                dataset_id=body.dataset_id,
                namespace=body.namespace,
                columns=body.columns,
                filter=body.filter,
                snapshot=body.snapshot,
                limit=body.limit,
                query_hash=body.query_hash,
                force_link=force_link,
            )
        )
        return {
            "mode": result.mode,
            "arrowBase64": result.arrow_base64,
            "r2Path": result.r2_path,
            "rowCount": result.row_count,
            "sizeBytes": result.size_bytes,
        }
    except Exception as e:
        logger.exception("query failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/sample")
def post_sample(body: SampleBody) -> dict[str, Any]:
    try:
        rows = sample(body.dataset_id, body.n, body.namespace)
        return {"rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get("/snapshots/{dataset_id}")
def get_snapshots(dataset_id: str, namespace: str = "default") -> dict[str, Any]:
    try:
        cat = catalog_mod.get_catalog()
        table_name = dataset_id.replace("-", "_")
        snaps = cat.list_snapshots(f"{namespace}.{table_name}")
        return {"snapshots": snaps}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/branch")
def post_branch(body: BranchBody) -> dict[str, str]:
    cat = catalog_mod.get_catalog()
    ident = f"{body.namespace}.{body.dataset_id.replace('-', '_')}"
    cat.create_branch(ident, body.branch, body.from_ref)
    return {"status": "ok"}


@app.post("/merge-branch")
def post_merge(body: BranchBody) -> dict[str, str]:
    cat = catalog_mod.get_catalog()
    ident = f"{body.namespace}.{body.dataset_id.replace('-', '_')}"
    cat.merge_branch(ident, body.branch, into=body.from_ref)
    return {"status": "ok"}
