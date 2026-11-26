"""Row Level Security is the backstop: it must hold even without app code."""
import uuid

import pytest
from sqlalchemy import exc, text

from app.db import user_tx

A = str(uuid.UUID(int=1))
B = str(uuid.UUID(int=2))


@pytest.fixture()
def two_users(admin_engine):
    with admin_engine.begin() as c:
        for uid, email in ((A, "a@example.test"), (B, "b@example.test")):
            c.execute(text("insert into journey.users (id, email) values (:id, :e)"), {"id": uid, "e": email})
            c.execute(
                text("insert into journey.papers (user_id, id, title) values (:u, :id, :t)"),
                {"u": uid, "id": "p-" + email[0], "t": "Paper of " + email[0]},
            )


def test_app_role_sees_nothing_without_user_id(two_users, app_engine):
    with app_engine.begin() as c:
        assert c.execute(text("select count(*) from journey.papers")).scalar() == 0
        assert c.execute(text("select count(*) from journey.users")).scalar() == 0


def test_app_role_sees_only_own_rows(two_users, app_engine):
    with user_tx(app_engine, A) as c:
        assert c.execute(text("select count(*) from journey.papers")).scalar() == 1
        row = c.execute(text("select id from journey.papers where id = 'p-b'")).first()
        assert row is None


def test_app_role_cannot_insert_for_other_user(two_users, app_engine):
    with pytest.raises(exc.DBAPIError, match="row-level security"):
        with user_tx(app_engine, A) as c:
            c.execute(
                text("insert into journey.papers (user_id, id, title) values (:u, 'x', 'x')"), {"u": B}
            )


def test_backup_role_reads_all_and_cannot_write(two_users, backup_engine):
    with backup_engine.begin() as c:
        c.execute(text("set row_security = on"))
        assert c.execute(text("select count(*) from journey.papers")).scalar() == 2
    with pytest.raises(exc.DBAPIError, match="permission denied"):
        with backup_engine.begin() as c:
            c.execute(text(f"insert into journey.papers (user_id, id, title) values ('{A}', 'y', 'y')"))


def test_public_schema_has_no_journey_tables(admin_engine):
    with admin_engine.begin() as c:
        n = c.execute(
            text(
                "select count(*) from information_schema.tables "
                "where table_schema = 'public' and table_name in ('papers', 'users')"
            )
        ).scalar()
    assert n == 0
