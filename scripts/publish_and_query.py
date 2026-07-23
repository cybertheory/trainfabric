#!/usr/bin/env python3
"""Publish fixture + run obvious/hard slice queries against live Trainfabric."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://trainfabric-router.rishabhspro.workers.dev"
FIXTURE = Path("/Users/rishabhsingh/Documents/trainfabric/fixtures/tidy_1k.csv")
OUT = Path("/Users/rishabhsingh/Documents/trainfabric/.tmp-query-results")
OUT.mkdir(exist_ok=True)


def req(method: str, path: str, data: bytes | None = None, headers: dict | None = None, timeout=600):
    h = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TrainfabricPublish/1.0",
        "Accept": "application/json,*/*",
    }
    h.update(headers or {})
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as res:
            body = res.read()
            ct = res.headers.get("content-type", "")
            if "json" in ct:
                return res.status, json.loads(body.decode() or "null")
            return res.status, body
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise RuntimeError(f"{method} {path} -> {e.code}: {err[:2000]}") from e


def multipart(fields: dict[str, str], file_field: str, filename: str, content: bytes, content_type: str):
    boundary = "----tfboundary7MA4YWxkTrZu0gW"
    parts: list[bytes] = []
    for k, v in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
        )
    parts.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        + content
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return body, f"multipart/form-data; boundary={boundary}"


def main() -> int:
    print("health", req("GET", "/health")[1])

    body, ctype = multipart(
        {
            "name": "nyc-taxi-1k",
            "description": "Real NYC taxi sample (1000 trips) for slice query demos",
            "tags": "transport,nyc,taxi,real",
            "visibility": "public",
            "partition_hint": "pickup_date",
            "sort_column": "pickup_date",
        },
        "file",
        "tidy_1k.csv",
        FIXTURE.read_bytes(),
        "text/csv",
    )
    print("publishing…")
    status, pub = req("POST", "/datasets", data=body, headers={"Content-Type": ctype}, timeout=120)
    print("publish", status, pub)
    dataset_id = pub["datasetId"]
    job_id = pub["jobId"]

    for i in range(90):
        _, job = req("GET", f"/jobs/{job_id}")
        print(f"job[{i}]", job.get("status"), job.get("progress"), job.get("error"))
        if job.get("status") in ("done", "error"):
            break
        time.sleep(5)
    else:
        print("job timeout")
        return 1
    if job.get("status") != "done":
        return 1

    _, ds = req("GET", f"/datasets/{dataset_id}")
    print("dataset", json.dumps({k: ds.get(k) for k in ("id", "name", "rowCount", "sizeBytes", "latestSnapshotId", "icebergTable", "icebergNamespace")}, indent=2))

    queries = [
        (
            "obvious_partition",
            {
                "columns": ["pickup_date", "fare_amount", "trip_distance", "vendor_id"],
                "filter": "pickup_date = '2024-01-01'",
                "mode": "link",
                "limit": 1000,
            },
        ),
        (
            "hard_nonpartition",
            {
                "columns": ["pickup_date", "fare_amount", "passenger_count", "trip_distance", "vendor_id"],
                "filter": "fare_amount > 40 AND trip_distance > 10",
                "mode": "link",
                "limit": 1000,
            },
        ),
    ]

    for name, payload in queries:
        print(f"\n=== estimate {name} ===")
        _, est = req(
            "POST",
            f"/datasets/{dataset_id}/estimate",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            timeout=300,
        )
        print(json.dumps(est, indent=2))

        print(f"=== query {name} ===")
        _, q = req(
            "POST",
            f"/datasets/{dataset_id}/query",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            timeout=600,
        )
        # Don't dump huge arrow
        summary = {k: q.get(k) for k in ("queryHash", "mode", "url", "costTier", "rowCount", "sizeBytes", "affordances")}
        summary["hasArrow"] = bool(q.get("arrowBase64"))
        print(json.dumps(summary, indent=2))
        (OUT / f"{name}-result.json").write_text(json.dumps(summary, indent=2))

        url = q.get("url")
        if url:
            # Follow download
            if url.startswith("/"):
                url = BASE + url
            print("downloading", url)
            try:
                # Must send browser UA — CF bot fight returns 403 otherwise
                dreq = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TrainfabricPublish/1.0",
                        "Accept": "*/*",
                    },
                )
                with urllib.request.urlopen(dreq, timeout=120) as res:
                    raw = res.read()
                path = OUT / f"{name}.bin"
                path.write_bytes(raw)
                print(f"saved {path} ({len(raw)} bytes)")
            except Exception as e:
                print("download failed:", e)

        arrow_b64 = q.get("arrowBase64")
        if arrow_b64:
            import base64

            path = OUT / f"{name}.arrow"
            path.write_bytes(base64.b64decode(arrow_b64))
            print(f"saved {path} ({path.stat().st_size} bytes)")

    print("\nDATASET_ID", dataset_id)
    print("DASHBOARD", f"{BASE}/")
    print("API_GET", f"{BASE}/datasets/{dataset_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
