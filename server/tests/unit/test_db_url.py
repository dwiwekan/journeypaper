"""Database URLs as Supabase's dashboard gives them still use psycopg 3 (psycopg2 is not installed)."""
from __future__ import annotations

import pytest

from app.db import make_engine, sqlalchemy_url


@pytest.mark.parametrize(
    "given, wanted",
    [
        ("postgresql://u:p@h:6543/db", "postgresql+psycopg://u:p@h:6543/db"),
        ("postgres://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"),
        ("postgresql+psycopg://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
    ],
)
def test_sqlalchemy_url_picks_psycopg3(given, wanted):
    assert sqlalchemy_url(given) == wanted


def test_make_engine_accepts_a_bare_postgresql_url():
    engine = make_engine("postgresql://u:p@localhost:1/db")
    assert engine.dialect.driver == "psycopg"
    engine.dispose()
