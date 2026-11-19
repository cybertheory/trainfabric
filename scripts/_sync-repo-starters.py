#!/usr/bin/env python3
"""Sync REPO_STARTER_FILES train/prepare/data_spec from autorunner templates."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
gh = root / "services/router/src/github.ts"
text = gh.read_text(encoding="utf-8")
train = (root / "services/autorunner/templates/train.py").read_text(encoding="utf-8")
prepare = (root / "services/autorunner/templates/prepare.py").read_text(encoding="utf-8")


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


data_spec = (
    '{\n'
    '  "uri": "s3://trainfabric-data/results/REPLACE_QUERY_HASH.parquet",\n'
    '  "format": "parquet",\n'
    '  "region": "auto"\n'
    "}\n"
)

start = text.index('"train.py": `')
end = text.index('".gitignore":', start)
new_block = (
    '"train.py": `'
    + esc(train)
    + "`,\n"
    + '  "prepare.py": `'
    + esc(prepare)
    + "`,\n"
    + '  "artifacts/data_spec.json": `'
    + esc(data_spec)
    + "`,\n"
    + "  "
)
text2 = text[:start] + new_block + text[end:]
text2 = text2.replace(
    "- For GPU data: query a lakehouse slice, write the TrainFabric \\`/r2/\\` result URL to \\`artifacts/data_url.txt\\` (nothing else). \\`train.py\\` downloads that URL at trial time.",
    "- For GPU data: write \\`artifacts/data_spec.json\\` with an \\`s3://\\` lakehouse URI (Modal mounts R2 at \\`/mnt/r2\\`). Optional legacy: \\`/r2/\\` URL in \\`artifacts/data_url.txt\\`.",
)
text2 = text2.replace(
    '"artifacts/data_url.txt": `# set by agent — TrainFabric /r2/ result URL only (one line, no other hosts)\n`,',
    '"artifacts/data_url.txt": `# optional legacy — TrainFabric /r2/ HTTPS URL (prefer data_spec.json)\n`,',
)
gh.write_text(text2, encoding="utf-8")
print("updated", gh)
