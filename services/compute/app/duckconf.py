"""DuckDB configuration for R2/S3-compatible httpfs access."""

from __future__ import annotations

import os
import duckdb


def configure_duckdb(con: duckdb.DuckDBPyConnection | None = None) -> duckdb.DuckDBPyConnection:
    con = con or duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL parquet; LOAD parquet;")

    endpoint = os.environ.get("R2_ENDPOINT", os.environ.get("S3_ENDPOINT", ""))
    # Strip scheme for DuckDB SET s3_endpoint
    endpoint_host = endpoint.replace("https://", "").replace("http://", "")
    access = os.environ.get("R2_ACCESS_KEY_ID", os.environ.get("AWS_ACCESS_KEY_ID", ""))
    secret = os.environ.get("R2_SECRET_ACCESS_KEY", os.environ.get("AWS_SECRET_ACCESS_KEY", ""))
    region = os.environ.get("R2_REGION", "auto")
    use_ssl = "true" if endpoint.startswith("https") or not endpoint else "false"

    if endpoint_host:
        con.execute(f"SET s3_endpoint='{endpoint_host}';")
    if access:
        con.execute(f"SET s3_access_key_id='{access}';")
    if secret:
        con.execute(f"SET s3_secret_access_key='{secret}';")
    con.execute(f"SET s3_region='{region}';")
    con.execute(f"SET s3_use_ssl={use_ssl};")
    con.execute("SET s3_url_style='path';")
    # Concurrency / readahead tuning
    con.execute("SET http_timeout=120000;")
    try:
        con.execute("SET s3_uploader_max_parts_per_file=100;")
        con.execute("SET s3_uploader_max_filesize='1GB';")
    except Exception:
        pass
    return con


def open_connection() -> duckdb.DuckDBPyConnection:
    return configure_duckdb()
