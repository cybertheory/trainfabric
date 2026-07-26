"""Hermes-style NL→DuckDB agent loop for Trainfabric compute."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from .gateway import AIGatewayError, mockable_chat
from .tools import TOOL_SPECS, dispatch_tool

logger = logging.getLogger("compute.hermes")

SKILL_PATH = Path(__file__).parent / "skills" / "duckdb-analytics" / "SKILL.md"
MAX_STEPS = 8


def load_duckdb_skill() -> str:
    if SKILL_PATH.exists():
        return SKILL_PATH.read_text(encoding="utf-8")
    return "Use DuckDB-compatible filters and prefer partition columns."


@dataclass
class PromptRequest:
    prompt: str
    dataset_id: str
    namespace: str = "default"
    execute: bool = True
    snapshot: Optional[str] = None
    max_steps: int = MAX_STEPS


@dataclass
class PromptResult:
    columns: list[str]
    filter: Optional[str]
    limit: Optional[int]
    sql: Optional[str]
    estimate: Optional[dict[str, Any]]
    explanation: str
    executed: bool
    result: Optional[dict[str, Any]] = None
    trace: list[dict[str, Any]] = field(default_factory=list)
    model: Optional[str] = None


def _parse_tool_args(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _message_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]]:
    return list(message.get("tool_calls") or [])


def run_hermes_prompt(req: PromptRequest) -> PromptResult:
    """Run Hermes DuckDB skill agent against a dataset."""
    skill = load_duckdb_skill()
    system = (
        "You are Hermes Agent with the duckdb-analytics skill, embedded in Trainfabric compute.\n"
        "Follow the skill. Always inspect schema before estimating or querying.\n"
        "Prefer partition-aligned filters. Finish with the finish tool.\n\n"
        f"{skill}"
    )
    user = (
        f"Dataset id: {req.dataset_id}\n"
        f"Namespace: {req.namespace}\n"
        f"Execute: {req.execute}\n"
        f"Snapshot: {req.snapshot or 'latest'}\n"
        f"User question: {req.prompt}"
    )

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    trace: list[dict[str, Any]] = []
    final: Optional[dict[str, Any]] = None
    executed_payload: Optional[dict[str, Any]] = None
    model_used: Optional[str] = None

    try:
        for step in range(req.max_steps):
            resp = mockable_chat(messages, TOOL_SPECS)
            model_used = resp.get("model") or model_used
            choice = (resp.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            tool_calls = _message_tool_calls(message)

            # Persist assistant turn
            messages.append(
                {
                    "role": "assistant",
                    "content": message.get("content"),
                    "tool_calls": tool_calls or None,
                }
            )

            if not tool_calls:
                # Model returned prose only — try to parse JSON plan, else heuristic
                content = message.get("content") or ""
                parsed = _try_parse_plan(content)
                if parsed:
                    final = parsed
                    break
                return _heuristic_fallback(req, trace=trace, explanation=content[:500])

            for tc in tool_calls:
                fn = (tc.get("function") or {})
                name = fn.get("name") or ""
                args = _parse_tool_args(fn.get("arguments"))
                out = dispatch_tool(
                    name,
                    args,
                    dataset_id=req.dataset_id,
                    namespace=req.namespace,
                    allow_execute=req.execute,
                )
                trace.append({"step": step, "tool": name, "args": args, "result": _shrink(out)})

                if isinstance(out, dict) and out.get("__finish__"):
                    final = out
                    break

                if name == "run_query" and isinstance(out, dict) and "error" not in out:
                    executed_payload = out

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.get("id") or name,
                        "content": json.dumps(out, default=str)[:12000],
                    }
                )

            if final is not None:
                break
    except AIGatewayError as e:
        # Workers AI often rejects OpenAI tool-calling; fall back to JSON-plan mode.
        logger.warning("AI Gateway tool loop failed — trying JSON plan mode: %s", e)
        json_plan = _llm_json_plan(req, skill=skill, gateway_error=str(e))
        if json_plan is not None:
            return json_plan
        logger.warning("JSON plan mode failed — using heuristic planner", exc_info=True)
        return _heuristic_fallback(
            req,
            explanation=f"Heuristic plan (AI Gateway tool/JSON modes failed: {e})",
        )

    if final is None:
        json_plan = _llm_json_plan(req, skill=skill)
        if json_plan is not None:
            return json_plan
        return _heuristic_fallback(req, trace=trace)

    columns = _ground_columns(list(final.get("columns") or []), req.dataset_id, req.namespace)
    filt = final.get("filter")
    if filt is not None:
        filt = str(filt).strip() or None
    limit = final.get("limit")
    if limit is not None:
        limit = int(limit)

    # Auto-execute if requested and not already done
    if req.execute and executed_payload is None and columns:
        try:
            executed_payload = dispatch_tool(
                "run_query",
                {"columns": columns, "filter": filt, "limit": limit or 1000},
                dataset_id=req.dataset_id,
                namespace=req.namespace,
                allow_execute=True,
            )
            if isinstance(executed_payload, dict) and "error" not in executed_payload:
                trace.append(
                    {
                        "step": "auto",
                        "tool": "run_query",
                        "args": {"columns": columns, "filter": filt, "limit": limit},
                        "result": _shrink(executed_payload),
                    }
                )
            else:
                # Keep the plan; surface execute error in trace instead of 500-ing.
                trace.append(
                    {
                        "step": "auto",
                        "tool": "run_query",
                        "args": {"columns": columns, "filter": filt, "limit": limit},
                        "result": _shrink(executed_payload) if isinstance(executed_payload, dict) else executed_payload,
                    }
                )
                executed_payload = None
        except Exception as e:
            logger.exception("auto execute failed")
            trace.append({"step": "auto", "tool": "run_query", "error": str(e)})
            executed_payload = None

    estimate = final.get("estimate")
    if not estimate:
        try:
            estimate = dispatch_tool(
                "estimate_query",
                {"columns": columns, "filter": filt},
                dataset_id=req.dataset_id,
                namespace=req.namespace,
                allow_execute=False,
            )
        except Exception:
            estimate = None

    return PromptResult(
        columns=columns,
        filter=filt,
        limit=limit,
        sql=final.get("sql"),
        estimate=estimate if isinstance(estimate, dict) else None,
        explanation=str(final.get("explanation") or ""),
        executed=bool(executed_payload),
        result=executed_payload,
        trace=trace,
        model=model_used,
    )


def _ground_columns(columns: list[Any], dataset_id: str, namespace: str) -> list[str]:
    """Map LLM column names onto real schema columns; drop hallucinations."""
    from .tools import get_schema

    try:
        schema = get_schema(dataset_id, namespace)
    except Exception:
        return [c for c in columns if isinstance(c, str)]
    col_names = [c.get("name") for c in (schema.get("columns") or []) if c.get("name")]
    lower_map = {c.lower(): c for c in col_names}
    # Common NL aliases → real columns
    aliases = {
        "fare": "fare_amount",
        "fares": "fare_amount",
        "amount": "fare_amount",
        "distance": "trip_distance",
        "tripdistance": "trip_distance",
        "date": "pickup_date",
        "pickup": "pickup_date",
    }
    grounded: list[str] = []
    for c in columns:
        if not isinstance(c, str):
            continue
        key = c.lower().replace(" ", "").replace("_", "")
        if c in col_names:
            grounded.append(c)
        elif c.lower() in lower_map:
            grounded.append(lower_map[c.lower()])
        elif c.lower() in aliases and aliases[c.lower()] in col_names:
            grounded.append(aliases[c.lower()])
        else:
            compact_aliases = {a.replace("_", ""): v for a, v in aliases.items()}
            if key in compact_aliases and compact_aliases[key] in col_names:
                grounded.append(compact_aliases[key])
    # de-dupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for c in grounded:
        if c not in seen:
            seen.add(c)
            out.append(c)
    if not out:
        return col_names[: min(5, len(col_names))]
    return out


def _shrink(obj: Any) -> Any:
    if not isinstance(obj, dict):
        return obj
    out = dict(obj)
    if "arrowBase64" in out and out["arrowBase64"]:
        out["arrowBase64"] = f"<omitted {len(out['arrowBase64'])} chars>"
    if "rows" in out and isinstance(out["rows"], list) and len(out["rows"]) > 5:
        out["rows"] = out["rows"][:5]
    return out


def _try_parse_plan(content: str) -> Optional[dict[str, Any]]:
    content = content.strip()
    if not content:
        return None
    try:
        # raw json
        data = json.loads(content)
        if isinstance(data, dict) and "columns" in data:
            return data
    except json.JSONDecodeError:
        pass
    # fenced json
    if "```" in content:
        for part in content.split("```"):
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            try:
                data = json.loads(part)
                if isinstance(data, dict) and "columns" in data:
                    return data
            except json.JSONDecodeError:
                continue
    return None


def _llm_json_plan(
    req: PromptRequest,
    *,
    skill: str,
    gateway_error: str = "",
) -> Optional[PromptResult]:
    """Ask the LLM for a JSON query plan without tool-calling (Workers AI compatible)."""
    from .tools import get_schema, estimate_query, run_query

    try:
        schema = get_schema(req.dataset_id, req.namespace)
    except Exception as e:
        logger.warning("schema load failed for JSON plan: %s", e)
        return None

    col_names = [c.get("name") for c in (schema.get("columns") or []) if c.get("name")]
    partitions = schema.get("partitionColumns") or []
    system = (
        "You are Hermes with the duckdb-analytics skill in Trainfabric compute.\n"
        "Return ONLY a JSON object (no markdown) with keys:\n"
        '  columns: string[], filter: string|null, limit: number, '
        "explanation: string, sql: string|null\n"
        "Prefer partition filters when possible. Use only real column names.\n\n"
        f"{skill}"
    )
    user = (
        f"Dataset id: {req.dataset_id}\n"
        f"Namespace: {req.namespace}\n"
        f"Columns: {json.dumps(col_names)}\n"
        f"Partition columns: {json.dumps(partitions)}\n"
        f"User question: {req.prompt}\n"
        "Respond with JSON only."
    )
    try:
        resp = mockable_chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            tools=None,
        )
    except AIGatewayError as e:
        logger.warning("JSON plan chat failed: %s (prior: %s)", e, gateway_error)
        return None

    model_used = resp.get("model") or "ai-gateway"
    content = (((resp.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    plan = _try_parse_plan(content)
    if not plan:
        return None

    columns = list(plan.get("columns") or [])
    grounded = _ground_columns(columns, req.dataset_id, req.namespace)

    filt = plan.get("filter")
    if filt is not None:
        filt = str(filt).strip() or None
    limit = plan.get("limit")
    try:
        limit = int(limit) if limit is not None else 1000
    except (TypeError, ValueError):
        limit = 1000

    estimate = estimate_query(req.dataset_id, columns=grounded, filter=filt, namespace=req.namespace)
    result = None
    executed = False
    if req.execute:
        result = run_query(
            req.dataset_id,
            columns=grounded,
            filter=filt,
            limit=limit,
            namespace=req.namespace,
        )
        if isinstance(result, dict) and "error" in result:
            # Keep plan; do not raise — caller returns 200 with executed=false.
            executed = False
        else:
            executed = True

    sql = plan.get("sql")
    if not sql:
        sql_cols = ", ".join(grounded) if grounded else "*"
        where = f" WHERE {filt}" if filt else ""
        sql = f"SELECT {sql_cols} FROM dataset{where} LIMIT {limit}"

    return PromptResult(
        columns=grounded,
        filter=filt,
        limit=limit,
        sql=sql,
        estimate=estimate,
        explanation=str(plan.get("explanation") or "LLM JSON plan via AI Gateway"),
        executed=executed,
        result=result,
        trace=[
            {
                "tool": "llm_json_plan",
                "gateway_error": gateway_error or None,
                "raw": content[:1000],
                "schema": _shrink(schema),
            }
        ],
        model=model_used,
    )


def _heuristic_fallback(
    req: PromptRequest,
    *,
    trace: Optional[list[dict[str, Any]]] = None,
    explanation: str = "",
) -> PromptResult:
    """Offline / no-LLM planner: schema + simple keyword filters."""
    import re

    from .tools import get_schema, estimate_query, run_query

    schema = get_schema(req.dataset_id, req.namespace)
    cols = [c["name"] for c in schema["columns"]]
    partitions = schema.get("partitionColumns") or []
    prompt_l = req.prompt.lower()

    # pick a few relevant columns by name mention, else all non-huge projection
    selected = [c for c in cols if c.lower() in prompt_l]
    if not selected:
        selected = cols[: min(5, len(cols))]

    filt = None
    for pcol in partitions:
        # look for ISO dates in prompt
        m = re.search(r"20\d{2}-\d{2}-\d{2}", req.prompt)
        if m:
            filt = f"{pcol} = '{m.group(0)}'"
            break

    if filt is None and "fare" in prompt_l and "fare_amount" in cols:
        m = re.search(r"(?:fare|amount)\s*(?:>=|>|over|above)\s*(\d+(?:\.\d+)?)", prompt_l)
        if m:
            filt = f"fare_amount > {m.group(1)}"

    estimate = estimate_query(req.dataset_id, columns=selected, filter=filt, namespace=req.namespace)
    result = None
    executed = False
    if req.execute:
        result = run_query(
            req.dataset_id,
            columns=selected,
            filter=filt,
            limit=1000,
            namespace=req.namespace,
        )
        executed = True

    sql_cols = ", ".join(selected) if selected else "*"
    where = f" WHERE {filt}" if filt else ""
    sql = f"SELECT {sql_cols} FROM dataset{where} LIMIT 1000"

    return PromptResult(
        columns=selected,
        filter=filt,
        limit=1000,
        sql=sql,
        estimate=estimate,
        explanation=explanation
        or "Heuristic plan (AI Gateway unavailable): schema-grounded columns + optional partition/date filter.",
        executed=executed,
        result=result,
        trace=trace or [{"tool": "heuristic", "schema": _shrink(schema)}],
        model="heuristic",
    )
