#!/usr/bin/env python3
import json
import urllib.request

UA = {"User-Agent": "Mozilla/5.0", "Accept": "*/*"}


def get(url: str):
    r = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(r, timeout=60) as res:
        return res.status, res.read()


_, body = get("https://trainfabric-router.rishabhspro.workers.dev/datasets")
ds = json.loads(body)["datasets"]
taxi = [(x["owner"], x["name"], x["id"]) for x in ds if "taxi" in x.get("name", "")]
print("taxi", taxi)
owner = next(x["owner"] for x in ds if x["name"] == "nyc-taxi-1k")
url = f"https://trainfabric-router.rishabhspro.workers.dev/datasets/{owner}/nyc-taxi-1k"
print("url", url)
st, html = get(url)
text = html.decode("utf-8", "replace")
print("page", st, "bytes", len(html))
print("has_dataset_chunk", "/_next/static/chunks/app/datasets" in text)
print("is_home", "Discover datasets" in text or "Browse public" in text)
print("has_loading", "Loading" in text)
