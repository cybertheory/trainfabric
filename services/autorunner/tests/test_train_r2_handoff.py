"""Smoke tests for starter train.py — mount path + legacy /r2/ download."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

TEMPLATES = Path(__file__).resolve().parents[1] / "templates"
TRAIN_PY = TEMPLATES / "train.py"


def _load_train():
    spec = importlib.util.spec_from_file_location("tf_starter_train", TRAIN_PY)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def train(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "artifacts").mkdir()
    return _load_train()


def test_rejects_non_trainfabric_urls(train):
    bad = [
        "https://huggingface.co/datasets/foo/resolve/main/data.parquet",
        "https://cdn.example.com/r2/foo",
        "http://trainfabric-router.rishabhspro.workers.dev/r2/foo",
        "https://trainfabric-router.rishabhspro.workers.dev/datasets/x",
        "https://trainfabric-router.rishabhspro.workers.dev/r2",
    ]
    for url in bad:
        assert train.is_trainfabric_r2_url(url) is False, url


def test_accepts_default_and_env_hosts(train, monkeypatch):
    ok = "https://trainfabric-router.rishabhspro.workers.dev/r2/results/abc.parquet"
    assert train.is_trainfabric_r2_url(ok) is True

    monkeypatch.setenv("TRAINFABRIC_API_URL", "https://tf.example.test")
    assert train.is_trainfabric_r2_url("https://tf.example.test/r2/slice.bin") is True
    assert train.is_trainfabric_r2_url(ok) is True


def test_main_refuses_bad_url(train, tmp_path):
    (tmp_path / "artifacts" / "data_url.txt").write_text(
        "https://huggingface.co/foo.parquet\n", encoding="utf-8"
    )
    with pytest.raises(SystemExit, match="refusing"):
        train.main()


def test_main_downloads_allowlisted_url(train, tmp_path):
    url = "https://trainfabric-router.rishabhspro.workers.dev/r2/results/tiny.bin"
    (tmp_path / "artifacts" / "data_url.txt").write_text(f"# comment\n{url}\n", encoding="utf-8")
    payload = b"parquet-bytes-xyz"

    mock_resp = MagicMock()
    mock_resp.read.side_effect = [payload, b""]
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = False

    with patch("urllib.request.urlopen", return_value=mock_resp) as opener:
        train.main()
        opener.assert_called_once()

    metrics = json.loads((tmp_path / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["score"] == float(len(payload))
    assert metrics["bytes"] == len(payload)
    assert metrics["uri"] == url
    assert (tmp_path / "artifacts" / "_tf_slice.bin").read_bytes() == payload


def test_main_reads_mounted_data_spec(train, tmp_path, monkeypatch):
    mount = tmp_path / "mnt" / "r2" / "results"
    mount.mkdir(parents=True)
    blob = mount / "qh.parquet"
    blob.write_bytes(b"abc123")
    (tmp_path / "artifacts" / "data_spec.json").write_text(
        json.dumps({"uri": "s3://trainfabric-data/results/qh.parquet", "format": "parquet"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("TF_DATA_ROOT", str(tmp_path / "mnt" / "r2"))
    monkeypatch.setenv("TF_DATA_PATH", str(blob))
    monkeypatch.setenv("TF_DATA_URI", "s3://trainfabric-data/results/qh.parquet")

    train.main()
    metrics = json.loads((tmp_path / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["bytes"] == 6
    assert metrics["source"] == "mount"


def test_skips_comment_only_file(train, tmp_path):
    (tmp_path / "artifacts" / "data_url.txt").write_text(
        "# optional legacy\n",
        encoding="utf-8",
    )
    with pytest.raises(SystemExit, match="missing"):
        train.main()
