#!/usr/bin/env python3
"""Create an R2-scoped Cloudflare API token and print S3 credentials."""
import hashlib
import json
import tomllib
import urllib.request

ACCOUNT = "e5793b12d9dd58ea18bde1fbbed5262b"
CONFIG = "/Users/rishabhsingh/Library/Preferences/.wrangler/config/default.toml"

with open(CONFIG, "rb") as f:
    oauth = tomllib.load(f)["oauth_token"]

body = {
    "name": "trainfabric-r2-s3",
    "policies": [
        {
            "effect": "allow",
            "resources": {
                f"com.cloudflare.edge.r2.bucket.{ACCOUNT}_default_trainfabric-data": "*",
            },
            "permission_groups": [
                {"id": "6a018a9f2fc74eb6b293b0c548f38b39"},
                {"id": "2efd3c4851304393bd072d5dbc1747e6"},
            ],
        }
    ],
}

req = urllib.request.Request(
    "https://api.cloudflare.com/client/v4/user/tokens",
    data=json.dumps(body).encode(),
    headers={
        "Authorization": f"Bearer {oauth}",
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req) as resp:
        data = json.load(resp)
except urllib.error.HTTPError as e:
    data = json.load(e)

print(json.dumps({"success": data.get("success"), "errors": data.get("errors")}, indent=2))
result = data.get("result") or {}
token_id = result.get("id")
value = result.get("value")
if token_id and value:
    secret = hashlib.sha256(value.encode()).hexdigest()
    out = {
        "R2_ACCESS_KEY_ID": token_id,
        "R2_SECRET_ACCESS_KEY": secret,
        "R2_ENDPOINT": f"https://{ACCOUNT}.r2.cloudflarestorage.com",
    }
    print(json.dumps(out, indent=2))
    with open("/Users/rishabhsingh/Documents/trainfabric/.r2-creds.json", "w") as f:
        json.dump(out, f)
    print("wrote .r2-creds.json")
else:
    print(json.dumps(data, indent=2)[:3000])
