"""Request-scoped CLI auth for Hermes → tf subprocesses."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Optional


@dataclass
class CliAuthContext:
    api_base: str
    auth_token: str
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    public_dataset_id: Optional[str] = None


_cli_auth: ContextVar[Optional[CliAuthContext]] = ContextVar("cli_auth", default=None)


def set_cli_auth(ctx: Optional[CliAuthContext]) -> None:
    _cli_auth.set(ctx)


def get_cli_auth() -> Optional[CliAuthContext]:
    return _cli_auth.get()
