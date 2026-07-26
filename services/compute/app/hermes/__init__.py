"""Hermes agent package — NL prompt → DuckDB/Iceberg slices."""

from .agent import PromptRequest, PromptResult, run_hermes_prompt

__all__ = ["PromptRequest", "PromptResult", "run_hermes_prompt"]
