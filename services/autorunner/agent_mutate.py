#!/usr/bin/env python3
"""Hermes-style mutate agent for Box autorunner via Cloudflare AI Gateway.

Edits only protocol mutablePaths, can generate/publish visualizations under
artifacts/viz/, and stages files for the trial commit.
"""

from __future__ import annotations

import json
import os
import subprocess
import traceback
from pathlib import Path
from typing import Any, Optional

MAX_STEPS = int(os.environ.get("AUTORUN_MUTATE_STEPS", "8"))
SKILLS_DIR = Path(os.environ.get("AUTORUN_SKILLS_DIR", os.path.expanduser("~/trainfabric/skills")))

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a UTF-8 text file from the research repo (relative path).",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write/overwrite a mutable file or artifacts/viz/* path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List files under a relative directory (default .).",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": "Run a short Python snippet in the repo cwd (for plots/metrics).",
            "parameters": {
                "type": "object",
                "properties": {"code": {"type": "string"}},
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "publish_viz",
            "description": "Save a matplotlib figure or write HTML/Markdown under artifacts/viz/ and stage it for git.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "e.g. trial3_mae.png or summary.md",
                    },
                    "python_plot_code": {
                        "type": "string",
                        "description": "Python that builds a matplotlib figure named `fig` (optional if content set).",
                    },
                    "content": {
                        "type": "string",
                        "description": "Raw text/HTML/Markdown body when not plotting.",
                    },
                    "caption": {"type": "string"},
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "Done mutating for this trial. Summarize what changed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "hypothesis": {"type": "string"},
                },
                "required": ["summary"],
            },
        },
    },
]


def _load_skills() -> str:
    chunks: list[str] = []
    names = [
        "autoresearch-mutate.md",
        "publish-viz-github.md",
        "trainfabric-cli.md",
    ]
    # Also support nested skill dirs if synced that way
    for name in names:
        p = SKILLS_DIR / name
        if p.is_file():
            chunks.append(f"## Skill: {name}\n{p.read_text(encoding='utf-8')[:12000]}")
    if not chunks:
        # Fall back to packaged skill text next to this module
        here = Path(__file__).resolve().parent / "skills"
        for rel in (
            "autoresearch-mutate/SKILL.md",
            "publish-viz-github/SKILL.md",
            "trainfabric-cli/SKILL.md",
        ):
            p = here / rel
            if p.is_file():
                chunks.append(f"## Skill: {rel}\n{p.read_text(encoding='utf-8')[:12000]}")
    return "\n\n".join(chunks) if chunks else "(no skill files loaded)"


def _norm_rel(path: str) -> str:
    raw = path.strip().lstrip("./")
    if not raw or raw.startswith("/") or ".." in Path(raw).parts:
        raise ValueError(f"invalid path: {path}")
    return raw


def _path_matches(rel: str, pattern: str) -> bool:
    import fnmatch

    pat = pattern.strip()
    if pat.endswith("/**"):
        prefix = pat[:-3].rstrip("/")
        return rel == prefix or rel.startswith(prefix + "/")
    if "*" in pat or "?" in pat:
        return fnmatch.fnmatch(rel, pat)
    return rel == pat or rel.startswith(pat.rstrip("/") + "/")


def _is_mutable(rel: str, protocol: dict[str, Any]) -> bool:
    mutable = [str(p) for p in (protocol.get("mutablePaths") or [])]
    immutable = [str(p) for p in (protocol.get("immutablePaths") or [])]
    if any(_path_matches(rel, i) for i in immutable):
        return False
    if rel.startswith("artifacts/viz/") or rel.startswith("artifacts/"):
        return True
    if not mutable:
        return rel.endswith(".py") and not rel.startswith(".")
    return any(_path_matches(rel, m) for m in mutable)


def propose_mutate(
    *,
    repo_dir: Path,
    protocol: dict[str, Any],
    hypothesis: str,
    trial_n: int,
    goal: str = "",
    steer: Optional[list[str]] = None,
    instructions: str = "",
) -> dict[str, Any]:
    """Run gateway tool loop. Returns {summary, hypothesis, files_touched, viz}.

    Falls back to a deterministic touch if gateway is unavailable.
    """
    try:
        from gateway import AIGatewayError, gateway_configured, mockable_chat
    except ImportError:
        import sys

        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from gateway import AIGatewayError, gateway_configured, mockable_chat  # type: ignore

    if not gateway_configured():
        return _fallback_touch(repo_dir, protocol, trial_n, hypothesis)

    skills = _load_skills()
    system = (
        "You are the Trainfabric autoresearch mutate agent (Hermes-parity) running in a Box sandbox.\n"
        "Use tools to edit ONLY mutable paths from protocol.yaml. You may also write artifacts/viz/*.\n"
        "Never modify immutablePaths. Prefer small, testable edits that could improve the metric.\n"
        "When useful, publish a visualization of the change or prior metrics via publish_viz.\n"
        "Call finish when the trial edit is ready to commit.\n\n"
        f"{skills}\n\n"
        f"## Repo brief\n{(instructions or '')[:6000]}\n\n"
        f"## Protocol\n{json.dumps(protocol, indent=2)[:4000]}\n"
    )
    user = (
        f"Trial {trial_n + 1}. Hypothesis context:\n{hypothesis}\n"
        f"Goal override: {goal or '(from repo brief)'}\n"
        f"Steer: {'; '.join(steer or []) or '(none)'}\n"
        "Make one coherent improvement and optionally publish a viz artifact."
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    touched: list[str] = []
    viz: list[str] = []
    summary = ""
    out_hypothesis = hypothesis

    for _ in range(MAX_STEPS):
        try:
            resp = mockable_chat(messages, TOOL_SPECS)
        except AIGatewayError as e:
            return {
                **_fallback_touch(repo_dir, protocol, trial_n, hypothesis),
                "gateway_error": str(e),
            }

        choice = (resp.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        tool_calls = msg.get("tool_calls") or []
        if msg.get("content") and not tool_calls:
            summary = str(msg["content"])[:1000]
            break

        if not tool_calls:
            break

        messages.append(
            {
                "role": "assistant",
                "content": msg.get("content"),
                "tool_calls": tool_calls,
            }
        )

        finished = False
        for tc in tool_calls:
            fn = (tc.get("function") or {}) if isinstance(tc, dict) else {}
            name = fn.get("name") or ""
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _dispatch(name, args, repo_dir, protocol, touched, viz)
            if name == "finish":
                summary = str(args.get("summary") or result.get("summary") or summary)[:1000]
                if args.get("hypothesis"):
                    out_hypothesis = str(args["hypothesis"])[:500]
                finished = True
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.get("id") or name,
                    "content": json.dumps(result)[:8000],
                }
            )
        if finished:
            break

    if not touched:
        return _fallback_touch(repo_dir, protocol, trial_n, out_hypothesis or hypothesis)

    _git_add(repo_dir, touched)
    return {
        "summary": summary or f"Mutated {', '.join(touched)}",
        "hypothesis": out_hypothesis,
        "files_touched": touched,
        "viz": viz,
        "via": "ai_gateway",
    }


def _fallback_touch(
    repo_dir: Path,
    protocol: dict[str, Any],
    trial_n: int,
    hypothesis: str,
) -> dict[str, Any]:
    mutable = (protocol.get("mutablePaths") or ["train.py"])[0]
    note = repo_dir / mutable
    if note.exists():
        with note.open("a", encoding="utf-8") as f:
            f.write(f"\n# autorunner touch trial={trial_n + 1} t={int(__import__('time').time())}\n")
        _git_add(repo_dir, [mutable])
    return {
        "summary": f"Gateway unavailable; appended touch to {mutable}",
        "hypothesis": hypothesis,
        "files_touched": [mutable] if note.exists() else [],
        "viz": [],
        "via": "fallback_touch",
    }


def _dispatch(
    name: str,
    args: dict[str, Any],
    repo_dir: Path,
    protocol: dict[str, Any],
    touched: list[str],
    viz: list[str],
) -> dict[str, Any]:
    try:
        if name == "list_dir":
            rel = _norm_rel(str(args.get("path") or "."))
            target = repo_dir if rel in (".", "") else repo_dir / rel
            if not target.exists():
                return {"error": "not found"}
            entries = sorted(p.name + ("/" if p.is_dir() else "") for p in target.iterdir())[:200]
            return {"entries": entries}
        if name == "read_file":
            rel = _norm_rel(str(args["path"]))
            text = (repo_dir / rel).read_text(encoding="utf-8")
            return {"path": rel, "content": text[:40000]}
        if name == "write_file":
            rel = _norm_rel(str(args["path"]))
            if not _is_mutable(rel, protocol):
                return {"error": f"path not mutable: {rel}"}
            path = repo_dir / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(str(args.get("content") or ""), encoding="utf-8")
            if rel not in touched:
                touched.append(rel)
            return {"ok": True, "path": rel}
        if name == "run_python":
            code = str(args.get("code") or "")
            proc = subprocess.run(
                ["python3", "-c", code],
                cwd=str(repo_dir),
                text=True,
                capture_output=True,
                timeout=60,
            )
            return {
                "returncode": proc.returncode,
                "stdout": (proc.stdout or "")[:4000],
                "stderr": (proc.stderr or "")[:2000],
            }
        if name == "publish_viz":
            return _publish_viz(args, repo_dir, protocol, touched, viz)
        if name == "finish":
            return {"ok": True, "summary": args.get("summary")}
        return {"error": f"unknown tool {name}"}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e), "trace": traceback.format_exc()[-1500:]}


def _publish_viz(
    args: dict[str, Any],
    repo_dir: Path,
    protocol: dict[str, Any],
    touched: list[str],
    viz: list[str],
) -> dict[str, Any]:
    filename = _norm_rel(str(args.get("filename") or "plot.png"))
    if "/" not in filename:
        filename = f"artifacts/viz/{filename}"
    if not filename.startswith("artifacts/viz/"):
        return {"error": "filename must be under artifacts/viz/"}
    if not _is_mutable(filename, protocol):
        return {"error": f"path not mutable: {filename}"}

    out = repo_dir / filename
    out.parent.mkdir(parents=True, exist_ok=True)
    plot_code = str(args.get("python_plot_code") or "").strip()
    content = args.get("content")

    if plot_code:
        wrapper = (
            "import matplotlib\nmatplotlib.use('Agg')\n"
            "import matplotlib.pyplot as plt\n"
            f"{plot_code}\n"
            "assert 'fig' in globals(), 'python_plot_code must define fig'\n"
            f"fig.savefig({filename!r}, bbox_inches='tight', dpi=140)\n"
            "plt.close(fig)\n"
        )
        proc = subprocess.run(
            ["python3", "-c", wrapper],
            cwd=str(repo_dir),
            text=True,
            capture_output=True,
            timeout=90,
        )
        if proc.returncode != 0:
            return {
                "error": "plot failed",
                "stderr": (proc.stderr or "")[:2000],
                "stdout": (proc.stdout or "")[:1000],
            }
    elif content is not None:
        out.write_text(str(content), encoding="utf-8")
    else:
        return {"error": "provide python_plot_code or content"}

    caption = str(args.get("caption") or "").strip()
    if caption:
        cap_path = out.with_suffix(out.suffix + ".caption.md")
        if str(cap_path.relative_to(repo_dir)).startswith("artifacts/viz/"):
            cap_path.write_text(caption + "\n", encoding="utf-8")
            crel = str(cap_path.relative_to(repo_dir))
            if crel not in touched:
                touched.append(crel)

    if filename not in touched:
        touched.append(filename)
    if filename not in viz:
        viz.append(filename)
    index = repo_dir / "artifacts" / "viz" / "README.md"
    line = f"- `{filename}`"
    if caption:
        line += f" — {caption}"
    prev = index.read_text(encoding="utf-8") if index.exists() else "# Autoresearch visualizations\n\n"
    if filename not in prev:
        index.write_text(prev.rstrip() + "\n" + line + "\n", encoding="utf-8")
        irel = "artifacts/viz/README.md"
        if irel not in touched:
            touched.append(irel)
    return {"ok": True, "path": filename, "caption": caption or None}


def _git_add(repo_dir: Path, rels: list[str]) -> None:
    if not rels:
        return
    quoted = " ".join(f"'{r}'" for r in rels)
    subprocess.run(
        f"git add {quoted}",
        shell=True,
        cwd=str(repo_dir),
        check=False,
        capture_output=True,
        text=True,
    )
