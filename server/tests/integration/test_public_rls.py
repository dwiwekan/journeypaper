"""journey_public: the role public requests run as. Postgres, not app code, keeps private rows hidden."""
import uuid

import pytest
from sqlalchemy import exc, text

from app.db import plain_tx, public_tx

A = str(uuid.UUID(int=1))

ROWS = [
    # id, is_public, deleted, is_sample
    ("pub", True, False, False),
    ("priv", False, False, False),
    ("gone", True, True, False),
    ("samp", True, False, True),
]


@pytest.fixture()
def seeded(admin_engine):
    with admin_engine.begin() as c:
        c.execute(text("insert into journey.users (id, email) values (:id, 'a@example.test')"), {"id": A})
        for pid, pub, gone, samp in ROWS:
            c.execute(
                text(
                    "insert into journey.papers (user_id, id, title, is_public, is_sample, deleted_at) "
                    "values (:u, :id, :t, :p, :s, case when :g then now() end)"
                ),
                {"u": A, "id": pid, "t": "Paper " + pid, "p": pub, "s": samp, "g": gone},
            )


def test_public_role_sees_only_public_live_non_sample(seeded, app_engine):
    with public_tx(app_engine) as c:
        ids = [r[0] for r in c.execute(text("select id from journey.papers"))]
    assert ids == ["pub"]


def test_public_tx_runs_as_journey_public_and_resets_after(app_engine):
    with public_tx(app_engine) as c:
        assert c.execute(text("select current_user")).scalar() == "journey_public"
        assert c.execute(text("select current_setting('app.user_id', true)")).scalar() in (None, "")
    for _ in range(3):  # every pooled connection is back to journey_app
        with plain_tx(app_engine) as c:
            assert c.execute(text("select current_user")).scalar() == "journey_app"


def test_public_role_cannot_read_users(seeded, app_engine):
    with pytest.raises(exc.ProgrammingError, match="permission denied"):
        with public_tx(app_engine) as c:
            c.execute(text("select email from journey.users"))


@pytest.mark.parametrize("col", ["is_public", "is_sample", "deleted_at", "revision"])
def test_public_role_cannot_read_flag_columns(seeded, app_engine, col):
    with pytest.raises(exc.ProgrammingError, match="permission denied"):
        with public_tx(app_engine) as c:
            c.execute(text(f"select {col} from journey.papers"))


@pytest.mark.parametrize(
    "sql",
    [
        f"insert into journey.papers (user_id, id, title) values ('{A}', 'new', 'x')",
        "update journey.papers set title = 'x'",
        "delete from journey.papers",
    ],
)
def test_public_role_cannot_write(seeded, app_engine, admin_engine, sql):
    with pytest.raises(exc.ProgrammingError, match="permission denied"):
        with public_tx(app_engine) as c:
            c.execute(text(sql))
    with admin_engine.begin() as c:
        assert c.execute(text("select count(*) from journey.papers")).scalar() == len(ROWS)
        assert c.execute(text("select count(*) from journey.papers where title = 'x'")).scalar() == 0


def test_app_role_without_user_id_sees_nothing(seeded, app_engine):
    with plain_tx(app_engine) as c:
        assert c.execute(text("select count(*) from journey.papers")).scalar() == 0


def test_policy_reads_flags_without_column_grant(seeded, app_engine):
    with public_tx(app_engine) as c:
        rows = c.execute(text("select user_id, id, title, content, body_text, updated_at from journey.papers")).all()
    assert [r.id for r in rows] == ["pub"]


@pytest.fixture()
def one_conn_engine(migrated_db):
    """One pooled connection, so the next transaction reuses the session the last one used."""
    from tests.conftest import ROLE_PASSWORD, TEST_DB, _url_for
    from sqlalchemy import create_engine

    eng = create_engine(_url_for(TEST_DB, "journey_app", ROLE_PASSWORD), pool_size=1, max_overflow=0,
                        connect_args={"prepare_threshold": None})
    yield eng
    eng.dispose()


def test_public_read_on_a_connection_that_served_a_member(seeded, one_conn_engine):
    from app.db import user_tx
    with user_tx(one_conn_engine, A) as c:
        assert c.execute(text("select count(*) from journey.papers")).scalar() == len(ROWS)
    # app.user_id is now '' (not NULL) on this session; neither role may trip over it.
    with public_tx(one_conn_engine) as c:
        assert [r[0] for r in c.execute(text("select id from journey.papers"))] == ["pub"]
    with plain_tx(one_conn_engine) as c:
        assert c.execute(text("select count(*) from journey.papers")).scalar() == 0


def test_own_rows_policy_is_only_for_the_app_role(admin_engine):
    with admin_engine.begin() as c:
        roles = {r.tablename: r.roles for r in c.execute(text(
            "select tablename, roles from pg_policies where schemaname = 'journey' and policyname = 'own_rows'"))}
    assert roles == {"papers": ["journey_app"], "users": ["journey_app"]}
