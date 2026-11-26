"""scripts/set_role_password.py: sets a role's password from an env var and never prints it."""
from __future__ import annotations

import psycopg
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from tests.conftest import ADMIN_URL

ROLE = "jp_pw_test"
SECRET = "s3cr3t-'quote\"-and-space value"


@pytest.fixture()
def throwaway_role():
    eng = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
        c.execute(text(f"CREATE ROLE {ROLE} LOGIN"))
    yield
    with eng.connect() as c:
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
    eng.dispose()


def test_sets_password_from_env_and_never_prints_it(throwaway_role, capsys):
    from scripts.set_role_password import main

    code = main([ROLE, "JP_TEST_PW"], {"MIGRATE_DATABASE_URL": ADMIN_URL, "JP_TEST_PW": SECRET})
    out = capsys.readouterr()
    assert code == 0
    assert out.out.strip() == f"password set for {ROLE}"
    assert SECRET not in out.out + out.err
    u = make_url(ADMIN_URL)
    with psycopg.connect(host=u.host, port=u.port, dbname="postgres", user=ROLE, password=SECRET) as conn:
        assert conn.execute("select current_user").fetchone()[0] == ROLE


def test_missing_or_empty_env_var_fails_without_changes(throwaway_role, capsys):
    from scripts.set_role_password import main

    assert main([ROLE, "JP_TEST_PW"], {"MIGRATE_DATABASE_URL": ADMIN_URL, "JP_TEST_PW": ""}) == 2
    assert main([ROLE, "JP_TEST_PW"], {"MIGRATE_DATABASE_URL": ADMIN_URL}) == 2
    assert "JP_TEST_PW is empty" in capsys.readouterr().err


def test_short_password_is_refused(throwaway_role, capsys):
    from scripts.set_role_password import main

    assert main([ROLE, "JP_TEST_PW"], {"MIGRATE_DATABASE_URL": ADMIN_URL, "JP_TEST_PW": "short"}) == 2
    assert "at least 20" in capsys.readouterr().err
