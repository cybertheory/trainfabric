#!/usr/bin/env python3
import base64
import json
import urllib.request
from pathlib import Path

BASE = "https://trainfabric-router.rishabhspro.workers.dev"
OUT = Path("/Users/rishabhsingh/Documents/trainfabric/.tmp-query-results")
OUT.mkdir(exist_ok=True)
UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TrainfabricPublish/1.0",
    "Accept": "*/*",
    "Content-Type": "application/json",
}
DS = "ds_a135d312f86c4b23"


def post(path, body):
    r = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(), headers=UA, method="POST"
    )
    with urllib.request.urlopen(r, timeout=600) as res:
        return json.loads(res.read().decode())


def download(url, dest: Path):
    if url.startswith("/"):
        url = BASE + url
    r = urllib.request.Request(
        url,
        headers={"User-Agent": UA["User-Agent"], "Accept": "*/*"},
    )
    with urllib.request.urlopen(r, timeout=120) as res:
        raw = res.read()
    dest.write_bytes(raw)
    print(f"saved {dest} ({len(raw)} bytes)")


obvious = post(
    f"/datasets/{DS}/query",
    {
        "columns": ["pickup_date", "fare_amount", "trip_distance", "vendor_id"],
        "filter": "pickup_date = '2024-01-01'",
        "mode": "link",
        "limit": 1000,
    },
)
print("obvious", {k: obvious.get(k) for k in ("costTier", "rowCount", "sizeBytes", "mode", "url")})
download(obvious["url"], OUT / "obvious_partition.parquet")

hard = post(
    f"/datasets/{DS}/query",
    {
        "columns": ["pickup_date", "fare_amount", "passenger_count", "trip_distance", "vendor_id"],
        "filter": "fare_amount > 40 AND trip_distance > 10",
        "mode": "link",
        "limit": 1000,
    },
)
print(
    "hard",
    {
        k: hard.get(k)
        for k in ("costTier", "rowCount", "sizeBytes", "mode", "url", "affordances")
    },
)
if hard.get("url"):
    download(hard["url"], OUT / "hard_nonpartition.parquet")
elif hard.get("arrowBase64"):
    raw = base64.b64decode(hard["arrowBase64"])
    dest = OUT / "hard_nonpartition.arrow"
    dest.write_bytes(raw)
    print(f"saved {dest} ({len(raw)} bytes)")
