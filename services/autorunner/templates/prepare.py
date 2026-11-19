#!/usr/bin/env python3
"""Immutable prepare step for Trainfabric autoresearch campaigns.

Training data is **not** fetched here. The Box agent writes
`artifacts/data_spec.json` (s3:// lakehouse URI) or legacy
`artifacts/data_url.txt` (/r2/ URL). Managed Modal mounts R2 at /mnt/r2;
`train.py` reads TF_DATA_PATH at trial time.
"""

from __future__ import annotations


def main() -> None:
    print(
        "prepare.py: no-op — GPU data comes from artifacts/data_spec.json "
        "(s3:// on Modal CloudBucketMount) or artifacts/data_url.txt"
    )


if __name__ == "__main__":
    main()
