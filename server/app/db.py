"""Database engine and transactions.

Every request that touches user data runs in one transaction that starts by
setting app.user_id, which the Row Level Security policies read. set_config(...,
true) is the bind-parameter form of SET LOCAL, so it ends with the transaction
and is safe behind Supabase's transaction pooler.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine


def sqlalchemy_url(url: str) -> str:
    """Supabase gives postgresql:// URLs, which SQLAlchemy maps to psycopg2; we ship psycopg 3."""
    for bare in ("postgresql://", "postgres://"):
        if url.startswith(bare):
            return "postgresql+psycopg://" + url[len(bare):]
    return url


def make_engine(url: str) -> Engine:
    # prepare_threshold=None turns off server-side prepared statements, which
    # the transaction pooler (port 6543) does not support. hide_parameters keeps
    # note text and emails out of error messages and logs.
    return create_engine(
        sqlalchemy_url(url),
        hide_parameters=True,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=2,
        connect_args={"prepare_threshold": None},
    )


@contextmanager
def user_tx(engine: Engine, user_id: str) -> Iterator[Connection]:
    with engine.begin() as conn:
        conn.execute(text("select set_config('app.user_id', :uid, true)"), {"uid": str(user_id)})
        yield conn


@contextmanager
def public_tx(engine: Engine) -> Iterator[Connection]:
    """A visitor's read: runs as journey_public, which sees only public, live, non-sample rows
    and only the granted columns. app.user_id is never set. SET LOCAL ends with the transaction,
    so the pooled connection goes back to journey_app."""
    with engine.begin() as conn:
        conn.execute(text("set local role journey_public"))
        yield conn


@contextmanager
def plain_tx(engine: Engine) -> Iterator[Connection]:
    with engine.begin() as conn:
        yield conn
