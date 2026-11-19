#!/usr/bin/env python3
"""GPU trial entrypoint — read lakehouse data from Modal CloudBucketMount (or legacy URL).

Preferred: artifacts/data_spec.json with an s3:// URI into the TrainFabric R2 warehouse.
Managed Modal mounts the bucket at TF_DATA_ROOT (/mnt/r2); this script reads TF_DATA_PATH.

Legacy: artifacts/data_url.txt with a TrainFabric Worker /r2/ HTTPS URL (small slices).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

DATA_SPEC_PATH = Path("artifacts/data_spec.json")
DATA_URL_PATH = Path("artifacts/data_url.txt")
RESOLVED_PATH = Path("artifacts/_tf_data_resolved.json")
DOWNLOAD_PATH = Path("artifacts/_tf_slice.bin")
METRICS_PATH = Path("metrics.json")
DEFAULT_HOSTS = frozenset({"trainfabric-router.rishabhspro.workers.dev"})
DEFAULT_MOUNT = "/mnt/r2"


def _api_hosts() -> set[str]:
    hosts = set(DEFAULT_HOSTS)
    for key in ("TRAINFABRIC_API_URL", "TF_API_URL"):
        raw = (os.environ.get(key) or "").strip()
        if not raw:
            continue
        try:
            host = urlparse(raw if "://" in raw else f"https://{raw}").hostname
        except Exception:
            host = None
        if host:
            hosts.add(host.lower())
    return hosts


def is_trainfabric_r2_url(url: str) -> bool:
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    if host not in _api_hosts():
        return False
    path = parsed.path or ""
    return "/r2/" in path and not path.rstrip("/").endswith("/r2")


def _read_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def resolve_data_path() -> tuple[str, Path | None, str]:
    """Return (uri, local_path_or_none, source). Prefer mount over HTTP download."""
    # Injected by Modal after resolving data_spec
    env_path = (os.environ.get("TF_DATA_PATH") or "").strip()
    env_uri = (os.environ.get("TF_DATA_URI") or "").strip()
    if env_path and Path(env_path).exists():
        return env_uri or env_path, Path(env_path), "mount"

    resolved = _read_json(RESOLVED_PATH)
    if resolved:
        mp = resolved.get("mount_path")
        uri = str(resolved.get("uri") or "")
        if mp and Path(str(mp)).exists():
            return uri, Path(str(mp)), "mount"

    spec = _read_json(DATA_SPEC_PATH)
    if spec and spec.get("uri"):
        uri = str(spec["uri"]).strip()
        if uri.startswith("s3://"):
            # Map s3://bucket/key → /mnt/r2/key
            rest = uri[5:]
            key = rest.split("/", 1)[1] if "/" in rest else ""
            mount = (os.environ.get("TF_DATA_ROOT") or DEFAULT_MOUNT).rstrip("/")
            local = Path(f"{mount}/{key}") if key else Path(mount)
            if local.exists():
                return uri, local, "data_spec"
            return uri, local, "data_spec_missing"
        if is_trainfabric_r2_url(uri):
            return uri, None, "https"
        raise SystemExit(f"unsupported data_spec.uri: {uri}")

    if DATA_URL_PATH.is_file():
        for line in DATA_URL_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if not is_trainfabric_r2_url(line):
                raise SystemExit(
                    "refusing non-TrainFabric URL — use data_spec.json s3://… "
                    "or https://trainfabric-router…/r2/…"
                )
            return line, None, "data_url"

    raise SystemExit(
        "missing artifacts/data_spec.json (s3://…) or artifacts/data_url.txt (/r2/ URL)"
    )


def download_https(url: str, dest: Path = DOWNLOAD_PATH) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={"Accept": "*/*", "User-Agent": "trainfabric-starter-train/2.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            # Stream to disk — do not buffer entire object in RAM
            with dest.open("wb") as out:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"download failed HTTP {e.code}: {url}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"download failed: {e}") from e
    if not dest.exists() or dest.stat().st_size == 0:
        raise SystemExit("download returned empty body")
    return dest


def score_path(path: Path) -> tuple[float, int]:
    """Cheap stand-in metric (lower is better): size of file or directory tree."""
    if path.is_file():
        n = path.stat().st_size
        return float(n), n
    total = 0
    if path.is_dir():
        for root, _dirs, files in os.walk(path):
            for name in files:
                try:
                    total += (Path(root) / name).stat().st_size
                except OSError:
                    continue
    return float(total), total


def main() -> None:
    uri, local, source = resolve_data_path()
    if local is not None and local.exists():
        path = local
    elif source in {"https", "data_url"} or (uri.startswith("https://")):
        path = download_https(uri)
    else:
        raise SystemExit(
            f"data not found on mount ({local}) — ensure Modal CloudBucketMount "
            f"and data_spec.uri point at s3://{os.environ.get('R2_BUCKET', 'trainfabric-data')}/…"
        )

    score, nbytes = score_path(path)
    rank = os.environ.get("TF_CLUSTER_RANK", "0")
    # Non-zero cluster ranks may participate in real distributed train; starter
    # only rank 0 writes metrics (Modal callback also filters rank 0).
    if rank not in {"0", ""}:
        print(json.dumps({"ok": True, "rank": rank, "skipped_metrics": True}))
        return

    METRICS_PATH.write_text(
        json.dumps(
            {
                "score": score,
                "bytes": nbytes,
                "uri": uri,
                "path": str(path),
                "source": source,
                "tier": os.environ.get("TF_COMPUTE_TIER"),
            }
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"ok": True, "score": score, "bytes": nbytes, "source": source}))


if __name__ == "__main__":
    main()
