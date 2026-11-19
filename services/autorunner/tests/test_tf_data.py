"""Tests for tf_data handoff + Modal tier selection."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tf_data import (  # noqa: E402
    CLUSTER_BYTES,
    GPU_BYTES,
    load_data_spec,
    parse_s3_uri,
    pick_compute_tier,
    s3_uri_to_mount_path,
)


def test_parse_s3_uri():
    assert parse_s3_uri("s3://trainfabric-data/results/abc.parquet") == (
        "trainfabric-data",
        "results/abc.parquet",
    )


def test_s3_uri_to_mount_path():
    assert (
        s3_uri_to_mount_path(
            "s3://trainfabric-data/warehouse/foo/",
            mount_root="/mnt/r2",
            expected_bucket="trainfabric-data",
        )
        == "/mnt/r2/warehouse/foo/"
    )


def test_load_data_spec_json(tmp_path):
    art = tmp_path / "artifacts"
    art.mkdir()
    (art / "data_spec.json").write_text(
        json.dumps(
            {
                "uri": "s3://trainfabric-data/results/qh.parquet",
                "format": "parquet",
                "size_bytes": 99,
            }
        ),
        encoding="utf-8",
    )
    spec = load_data_spec(tmp_path, mount_root="/mnt/r2")
    assert spec is not None
    assert spec.uri.endswith("qh.parquet")
    assert spec.mount_path == "/mnt/r2/results/qh.parquet"
    assert spec.size_bytes == 99


def test_rejects_secrets_in_data_spec(tmp_path):
    art = tmp_path / "artifacts"
    art.mkdir()
    (art / "data_spec.json").write_text(
        json.dumps(
            {
                "uri": "s3://trainfabric-data/x",
                "aws_secret_access_key": "nope",
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="secret"):
        load_data_spec(tmp_path)


def test_legacy_data_url_maps_to_s3(tmp_path):
    art = tmp_path / "artifacts"
    art.mkdir()
    (art / "data_url.txt").write_text(
        "https://trainfabric-router.rishabhspro.workers.dev/r2/results/abc.parquet\n",
        encoding="utf-8",
    )
    spec = load_data_spec(tmp_path, mount_root="/mnt/r2")
    assert spec is not None
    assert spec.uri == "s3://trainfabric-data/results/abc.parquet"
    assert spec.mount_path == "/mnt/r2/results/abc.parquet"
    assert spec.source == "data_url"


def test_pick_compute_tier():
    assert pick_compute_tier(estimated_bytes=0) == "cpu"
    assert pick_compute_tier(estimated_bytes=GPU_BYTES) == "gpu"
    assert pick_compute_tier(estimated_bytes=CLUSTER_BYTES) == "cluster"
    assert pick_compute_tier(estimated_bytes=10, gpu_nodes=2) == "cluster"
    assert pick_compute_tier(estimated_bytes=10, cluster=True) == "cluster"


def test_override_data_spec(tmp_path):
    spec = load_data_spec(
        tmp_path,
        override={"uri": "s3://trainfabric-data/prefix/", "cluster": True},
    )
    assert spec is not None
    assert spec.cluster is True
    assert spec.mount_path == "/mnt/r2/prefix/"
