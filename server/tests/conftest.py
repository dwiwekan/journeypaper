"""Shared fixtures. Integration tests need the local Postgres from `make db-up`."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ADMIN_URL = os.environ.get(
    "TEST_DATABASE_ADMIN_URL", "postgresql+psycopg://postgres:dev@localhost:5433/postgres"
)
TEST_DB = "journey_test"


def _url_for(db: str, user: str | None = None, password: str | None = None) -> str:
    url = make_url(ADMIN_URL).set(database=db)
    if user:
        url = url.set(username=user, password=password)
    return url.render_as_string(hide_password=False)


@pytest.fixture(scope="session")
def test_db_url() -> str:
    """A fresh database for this test run, as the owner role."""
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)'))
        c.execute(text(f'CREATE DATABASE "{TEST_DB}"'))
    admin.dispose()
    return _url_for(TEST_DB)


@pytest.fixture()
def keys():
    """(private_key, StaticKeys): the test stand-in for Supabase's JWKS."""
    from tests.jwt_helpers import make_keys

    return make_keys()


def _settings(**overrides):
    from app.config import Settings
    from tests.jwt_helpers import SUPABASE

    base = dict(database_url=_url_for(TEST_DB, "journey_app", ROLE_PASSWORD), supabase_url=SUPABASE, admin_emails=[])
    base.update(overrides)
    return Settings(**base)


@pytest.fixture()
def settings(migrated_db):
    """The app connects as journey_app, exactly as in production."""
    return _settings()


@pytest.fixture()
def make_client(migrated_db, admin_engine, keys):
    """Builds a TestClient for an app with the given Settings overrides."""
    from contextlib import ExitStack

    from fastapi.testclient import TestClient

    from app.deps import get_key_source
    from app.main import create_app

    with ExitStack() as stack:
        def build(**overrides):
            app = create_app(_settings(**overrides))
            app.dependency_overrides[get_key_source] = lambda: keys[1]
            return stack.enter_context(TestClient(app))

        yield build


@pytest.fixture()
def app_client(make_client):
    return make_client()


# ---------- migrated schema and role engines (Task 2) ----------
# Roles are shared by every database in the local cluster, so tests use the same
# password as the dev DATABASE_URL in .env.example. Local machine only.
ROLE_PASSWORD = "dev"


@pytest.fixture(scope="session")
def migrated_db(test_db_url) -> str:
    """Runs every migration on the test database and gives the roles a test password."""
    from alembic import command
    from alembic.config import Config

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config(os.path.join(here, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(here, "migrations"))
    cfg.attributes["url"] = test_db_url
    command.upgrade(cfg, "head")
    eng = create_engine(test_db_url)
    with eng.begin() as c:
        for role in ("journey_app", "journey_backup"):
            c.execute(text(f"ALTER ROLE {role} WITH PASSWORD '{ROLE_PASSWORD}'"))
    eng.dispose()
    return test_db_url


@pytest.fixture(scope="session")
def admin_engine(migrated_db):
    eng = create_engine(migrated_db)
    yield eng
    eng.dispose()


@pytest.fixture(scope="session")
def app_engine(migrated_db):
    from app.db import make_engine

    eng = make_engine(_url_for(TEST_DB, "journey_app", ROLE_PASSWORD))
    yield eng
    eng.dispose()


@pytest.fixture(scope="session")
def backup_engine(migrated_db):
    eng = create_engine(_url_for(TEST_DB, "journey_backup", ROLE_PASSWORD))
    yield eng
    eng.dispose()


@pytest.fixture(autouse=True)
def _clean_tables(request):
    """Empties the journey tables before each test that uses the database."""
    if not {"admin_engine", "app_client", "make_client"} & set(request.fixturenames):
        yield
        return
    eng = request.getfixturevalue("admin_engine")
    with eng.begin() as c:
        c.execute(text("TRUNCATE journey.papers, journey.users CASCADE"))
    yield
