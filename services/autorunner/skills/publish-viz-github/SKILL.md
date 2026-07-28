---
name: publish-viz-github
description: Publish autoresearch plots and HTML summaries under artifacts/viz/ so they commit and push to the campaign GitHub repo.
metadata:
  hermes:
    tags: [visualization, github, autoresearch]
---

# Publish visualizations to GitHub

Put research visuals in the **campaign repo** so humans can review them on GitHub (and in PRs/commits when trials are kept).

## Layout

```
artifacts/viz/
  README.md          # index of published assets
  trial3_mae.png     # example plot
  trial3_mae.png.caption.md
  summary.md         # optional narrative
```

## How

Use the `publish_viz` tool:

1. **Plot**: pass `filename` (e.g. `trial3_mae.png`) and `python_plot_code` that defines a matplotlib `fig`.
2. **Text/HTML**: pass `filename` ending in `.md` / `.html` and `content`.
3. Always set a short `caption` when useful — it updates `artifacts/viz/README.md`.

Paths must stay under `artifacts/viz/`. Do not write secrets or large binaries (no checkpoints).

## Git flow

- Viz files are staged with the trial mutate commit.
- **Kept** trials: daemon `git push`es the commit (code + viz) to the campaign branch.
- **Not kept** trials: code reverts, but the daemon re-applies and pushes `artifacts/viz/` when possible so plots still appear on GitHub.

## Tips

- Name files with trial number + metric (`trial12_val_bpb.png`).
- Prefer one clear chart per trial over many noisy plots.
- Reference the viz path in your `finish` summary.
