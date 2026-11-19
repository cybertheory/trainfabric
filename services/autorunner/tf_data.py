"""Parse agent data handoff for managed Modal GPU trials.

Supports:
  - artifacts/data_spec.json  (preferred — s3:// / R2 lakehouse paths)
  - artifacts/data_url.txt    (legacy TrainFabric Worker /r2/ HTTPS URL)

No secrets in git — credentials live on the Modal image (CloudBucketMount secret).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

DATA_SPEC_PATH = Path("artifacts/data_spec.json")
DATA_URL_PATH = Path("artifacts/data_url.txt")
DEFAULT_MOUNT = "/mnt/r2"
DEFAULT_BUCKET = "trainfabric-data"
SECRET_KEYS = frozenset(
    {
        "aws_access_key_id",
        "aws_secret_access_key",
        "aws_session_token",
        "secret_access_key",
        "access_key_id",
        "password",
        "token",
        "credential",
        "credentials",
    }
)

# Prefer multi-GPU when the agent declares this many bytes (or more).
GPU_BYTES = int(os.environ.get("TF_GPU_BYTES", str(50 * 1024 * 1024)))
# Prefer multi-node Modal cluster at/above this size.
CLUSTER_BYTES = int(os.environ.get("TF_CLUSTER_BYTES", str(1 * 1024 * 1024 * 1024)))


@dataclass
class DataSpec:
    uri: str
    endpoint_url: Optional[str] = None
    format: Optional[str] = None
    region: Optional[str] = None
    size_bytes: Optional[int] = None
    cluster: Optional[bool] = None
    mount_path: Optional[str] = None  # resolved local path under CloudBucketMount
    source: str = "data_spec"  # data_spec | data_url

    def to_dict(self) -> dict[str, Any]:
        return {
            "uri": self.uri,
            "endpoint_url": self.endpoint_url,
            "format": self.format,
            "region": self.region,
            "size_bytes": self.size_bytes,
            "cluster": self.cluster,
            "mount_path": self.mount_path,
            "source": self.source,
        }


def _reject_secrets(obj: Any, path: str = "") -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = str(k).lower()
            if key in SECRET_KEYS or "secret" in key or "password" in key:
                raise ValueError(f"refusing secret field in data_spec: {path}{k}")
            _reject_secrets(v, f"{path}{k}.")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _reject_secrets(v, f"{path}[{i}].")


def parse_s3_uri(uri: str) -> tuple[str, str]:
    """Return (bucket, key) for s3://bucket/key."""
    raw = uri.strip()
    if not raw.startswith("s3://"):
        raise ValueError(f"not an s3 URI: {uri}")
    rest = raw[5:]
    if "/" not in rest:
        return rest, ""
    bucket, key = rest.split("/", 1)
    return bucket, key


def s3_uri_to_mount_path(
    uri: str,
    *,
    mount_root: str = DEFAULT_MOUNT,
    expected_bucket: Optional[str] = None,
) -> str:
    bucket, key = parse_s3_uri(uri)
    exp = expected_bucket or os.environ.get("R2_BUCKET") or DEFAULT_BUCKET
    if bucket != exp:
        # Still map under mount; CloudBucketMount is one bucket — warn via path prefix.
        # Prefer same-bucket lakehouse URIs.
        pass
    root = mount_root.rstrip("/")
    if not key:
        return root
    return f"{root}/{key.lstrip('/')}"


def r2_https_to_key(url: str) -> Optional[str]:
    """Extract object key from https://…/r2/<key>."""
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return None
    path = parsed.path or ""
    m = re.search(r"/r2/(.+)$", path)
    if not m:
        return None
    return m.group(1)


def read_legacy_data_url(path: Path = DATA_URL_PATH) -> Optional[str]:
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        return line
    return None


def load_data_spec(
    repo: Path,
    *,
    mount_root: str = DEFAULT_MOUNT,
    override: Optional[dict[str, Any]] = None,
) -> Optional[DataSpec]:
    """Load data_spec from override dict, repo JSON, or legacy data_url.txt."""
    if override:
        _reject_secrets(override)
        uri = str(override.get("uri") or "").strip()
        if not uri:
            return None
        spec = DataSpec(
            uri=uri,
            endpoint_url=(str(override["endpoint_url"]) if override.get("endpoint_url") else None),
            format=(str(override["format"]) if override.get("format") else None),
            region=(str(override["region"]) if override.get("region") else None),
            size_bytes=_as_int(override.get("size_bytes") or override.get("estimated_bytes")),
            cluster=_as_bool(override.get("cluster")),
            source="override",
        )
        return _with_mount(spec, mount_root)

    spec_path = repo / DATA_SPEC_PATH
    if spec_path.is_file():
        raw = json.loads(spec_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("data_spec.json must be an object")
        _reject_secrets(raw)
        uri = str(raw.get("uri") or "").strip()
        if not uri:
            raise ValueError("data_spec.json missing uri")
        spec = DataSpec(
            uri=uri,
            endpoint_url=(str(raw["endpoint_url"]) if raw.get("endpoint_url") else None),
            format=(str(raw["format"]) if raw.get("format") else None),
            region=(str(raw["region"]) if raw.get("region") else None),
            size_bytes=_as_int(raw.get("size_bytes") or raw.get("estimated_bytes")),
            cluster=_as_bool(raw.get("cluster")),
            source="data_spec",
        )
        return _with_mount(spec, mount_root)

    url = read_legacy_data_url(repo / DATA_URL_PATH)
    if url:
        key = r2_https_to_key(url)
        if key:
            bucket = os.environ.get("R2_BUCKET") or DEFAULT_BUCKET
            spec = DataSpec(
                uri=f"s3://{bucket}/{key}",
                format="parquet" if key.endswith(".parquet") else None,
                source="data_url",
            )
            return _with_mount(spec, mount_root)
        return DataSpec(uri=url, source="data_url")

    return None


def _with_mount(spec: DataSpec, mount_root: str) -> DataSpec:
    if spec.uri.startswith("s3://"):
        spec.mount_path = s3_uri_to_mount_path(spec.uri, mount_root=mount_root)
    elif spec.uri.startswith("https://"):
        key = r2_https_to_key(spec.uri)
        if key:
            spec.mount_path = f"{mount_root.rstrip('/')}/{key}"
    return spec


def _as_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _as_bool(v: Any) -> Optional[bool]:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in {"1", "true", "yes"}
    return bool(v)


def pick_compute_tier(
    *,
    estimated_bytes: Optional[int] = None,
    gpu_nodes: Optional[int] = None,
    cluster: Optional[bool] = None,
) -> str:
    """Return 'cluster' | 'gpu' | 'cpu' for Modal dispatch."""
    if gpu_nodes is not None and gpu_nodes > 1:
        return "cluster"
    if cluster:
        return "cluster"
    nbytes = estimated_bytes or 0
    if nbytes >= CLUSTER_BYTES:
        return "cluster"
    if nbytes >= GPU_BYTES:
        return "gpu"
    return "cpu"


def write_data_env(repo: Path, spec: Optional[DataSpec]) -> dict[str, str]:
    """Env vars injected into train.py so it can read the mounted lakehouse."""
    env: dict[str, str] = {
        "TF_DATA_ROOT": os.environ.get("TF_DATA_ROOT") or DEFAULT_MOUNT,
    }
    if not spec:
        return env
    env["TF_DATA_URI"] = spec.uri
    if spec.mount_path:
        env["TF_DATA_PATH"] = spec.mount_path
    if spec.format:
        env["TF_DATA_FORMAT"] = spec.format
    # Persist resolved paths for the entrypoint
    out = repo / "artifacts" / "_tf_data_resolved.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec.to_dict(), indent=2) + "\n", encoding="utf-8")
    return env
