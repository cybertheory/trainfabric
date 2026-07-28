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


def _coerce_text_content(content: Any) -> Optional[str]:
    """Normalize OpenAI-style content to a plain string."""
    if content is None:
        return None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for p in content:
            if isinstance(p, str):
                parts.append(p)
            elif isinstance(p, dict):
                if p.get("type") == "text":
                    parts.append(str(p.get("text") or ""))
                elif "text" in p:
                    parts.append(str(p.get("text") or ""))
        return "".join(parts)
    return str(content)


def _extract_json_obj(text: str) -> Optional[dict[str, Any]]:
    raw = (text or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(raw[start : end + 1])
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    return None


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
    """Propose a mutable-file edit via Cloudflare AI Gateway.

    Uses a JSON single-shot completion (Workers AI rejects multi-turn tool
    results). Falls back to a deterministic touch if gateway is unavailable.
    """
    try:
        from app.hermes.gateway import AIGatewayError, gateway_configured, mockable_chat
    except ImportError:
        try:
            from gateway import AIGatewayError, gateway_configured, mockable_chat
        except ImportError:
            import sys

            sys.path.insert(0, str(Path(__file__).resolve().parent))
            sys.path.insert(0, str(Path.home() / "trainfabric"))
            try:
                from app.hermes.gateway import (  # type: ignore
                    AIGatewayError,
                    gateway_configured,
                    mockable_chat,
                )
            except ImportError:
                from gateway import AIGatewayError, gateway_configured, mockable_chat  # type: ignore

    if not gateway_configured():
        return _fallback_touch(
            repo_dir,
            protocol,
            trial_n,
            hypothesis,
            reason="AI Gateway not configured in Box (need CF_AI_GATEWAY_TOKEN + account/base)",
        )

    mutable_paths = [str(p) for p in (protocol.get("mutablePaths") or ["train.py"])]
    primary = mutable_paths[0]
    primary_path = repo_dir / primary
    current = ""
    if primary_path.is_file():
        try:
            current = primary_path.read_text(encoding="utf-8")
        except OSError:
            current = ""

    system = (
        "You are the Trainfabric autoresearch mutate agent.\n"
        "Return ONLY a JSON object (no markdown fences) with keys:\n"
        '  path: mutable relative path,\n'
        "  old: exact existing substring to replace (copy verbatim from the file),\n"
        "  new: replacement substring (real code change, not a comment-only touch),\n"
        "  summary: short description,\n"
        "  hypothesis: short hypothesis for this trial.\n"
        "Keep old/new small (prefer < 40 lines). Never modify immutable paths.\n"
        f"Primary mutable path: {primary}\n"
        f"Allowed mutable paths: {mutable_paths}\n"
        f"Protocol: {json.dumps(protocol)[:2000]}\n"
    )
    user = (
        f"Trial {trial_n + 1}.\n"
        f"Hypothesis context: {hypothesis}\n"
        f"Goal: {goal or '(from repo brief)'}\n"
        f"Steer: {'; '.join(steer or []) or '(none)'}\n"
        f"Brief: {(instructions or '')[:3000]}\n\n"
        f"Current {primary}:\n```\n{current[:14000]}\n```\n"
        "Respond with the JSON object only."
    )

    try:
        resp = mockable_chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            tools=None,
            temperature=0.2,
            timeout=90.0,
        )
    except AIGatewayError as e:
        return {
            **_fallback_touch(
                repo_dir,
                protocol,
                trial_n,
                hypothesis,
                reason=f"Gateway error: {str(e)[:240]}",
            ),
            "gateway_error": str(e),
        }

    choice = (resp.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    text = _coerce_text_content(msg.get("content")) or ""
    obj = _extract_json_obj(text)
    if not obj:
        return _fallback_touch(
            repo_dir,
            protocol,
            trial_n,
            hypothesis,
            reason=f"Model returned non-JSON mutate response: {text[:120]!r}",
        )

    rel = str(obj.get("path") or primary).strip() or primary
    old = obj.get("old")
    new = obj.get("new")
    # Back-compat: accept full-file content rewrite if provided and valid
    content = obj.get("content")

    try:
        rel = _norm_rel(rel)
    except ValueError as e:
        return _fallback_touch(
            repo_dir,
            protocol,
            trial_n,
            hypothesis,
            reason=f"Invalid path in mutate JSON: {e}",
        )

    if not _is_mutable(rel, protocol):
        return _fallback_touch(
            repo_dir,
            protocol,
            trial_n,
            hypothesis,
            reason=f"Mutate path not mutable: {rel}",
        )

    path = repo_dir / rel
    if not path.is_file() and not (isinstance(content, str) and content.strip()):
        return _fallback_touch(
            repo_dir,
            protocol,
            trial_n,
            hypothesis,
            reason=f"Mutate target missing: {rel}",
        )

    before = path.read_text(encoding="utf-8") if path.is_file() else ""
    after: Optional[str] = None

    if isinstance(old, str) and isinstance(new, str) and old:
        if old not in before:
            return _fallback_touch(
                repo_dir,
                protocol,
                trial_n,
                hypothesis,
                reason="Mutate old snippet not found in file",
            )
        if old == new:
            return _fallback_touch(
                repo_dir,
                protocol,
                trial_n,
                hypothesis,
                reason="Mutate old/new identical",
            )
        after = before.replace(old, new, 1)
    elif isinstance(content, str) and content.strip():
        after = content
    else:
        return _fallback_touch(
            repo_dir,
            protocol,
            trial_n,
            hypothesis,
            reason="JSON mutate missing old/new (or content)",
        )

    if after.strip() == before.strip():
        return _fallback_touch(
            repo_dir,
            protocol,
            trial_n,
            hypothesis,
            reason="Mutate content unchanged",
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(after, encoding="utf-8")
    touched = [rel]
    _git_add(repo_dir, touched)
    summary = str(obj.get("summary") or f"Mutated {rel}")[:1000]
    out_hypothesis = str(obj.get("hypothesis") or hypothesis)[:500]
    return {
        "summary": summary,
        "hypothesis": out_hypothesis,
        "files_touched": touched,
        "viz": [],
        "via": "ai_gateway",
    }


def _fallback_touch(
    repo_dir: Path,
    protocol: dict[str, Any],
    trial_n: int,
    hypothesis: str,
    *,
    reason: str = "Gateway unavailable",
) -> dict[str, Any]:
    mutable = (protocol.get("mutablePaths") or ["train.py"])[0]
    note = repo_dir / mutable
    if note.exists():
        with note.open("a", encoding="utf-8") as f:
            f.write(f"\n# autorunner touch trial={trial_n + 1} t={int(__import__('time').time())}\n")
        _git_add(repo_dir, [mutable])
    return {
        "summary": f"{reason}; appended touch to {mutable}",
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
