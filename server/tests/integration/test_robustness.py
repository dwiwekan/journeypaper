"""Inputs Postgres rejects, unexpected errors, and the migration bookkeeping table."""
import os

import pytest
from sqlalchemy import exc, text

from tests.conftest import TEST_DB
from tests.jwt_helpers import bearer

P = "/api/v1/papers"
T0 = 1_700_000_000_123


def item(pid, title="T"):
    return {"id": pid, "title": title, "createdAt": T0, "updatedAt": T0,
            "content": [{"id": "b1", "type": "p", "text": "hi"}, {"id": "b2", "type": "code", "text": "a\x00b"}]}


def test_nul_bytes_are_stripped_on_import(app_client, keys):
    h = bearer(keys[0])
    r = app_client.post("/api/v1/import", json=[item("good1"), item("nul1", "Ti\x00tle"), item("good2")], headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"created": 3, "updated": 0, "skipped": 0, "errors": []}
    got = app_client.get(f"{P}/nul1", headers=h).json()
    assert got["title"] == "Title"
    assert got["content"][1]["text"] == "ab"


def test_nul_bytes_are_stripped_on_patch(app_client, keys):
    h = bearer(keys[0])
    made = app_client.post(P, json={"title": "T"}, headers=h).json()
    r = app_client.patch(f"{P}/{made['id']}", json={"summary": "x\x00y", "content": [{"type": "p", "text": "a\x00b"}]},
                         headers={**h, "If-Match": str(made["revision"])})
    assert r.status_code == 200, r.text
    got = app_client.get(f"{P}/{made['id']}", headers=h).json()
    assert got["summary"] == "xy" and got["content"][0]["text"] == "ab"


def test_a_database_error_on_one_import_item_is_reported_and_the_rest_saved(app_client, keys, monkeypatch):
    from app.repos import papers as repo

    real = repo.upsert_import

    def flaky(conn, user_id, row):
        if row["id"] == "bad":
            conn.execute(text("select 1/0"))
        return real(conn, user_id, row)

    monkeypatch.setattr(repo, "upsert_import", flaky)
    h = bearer(keys[0])
    r = app_client.post("/api/v1/import", json=[item("a1"), item("bad"), item("a2")], headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["created"], [e["id"] for e in out["errors"]]) == (2, ["bad"])
    assert "division" not in out["errors"][0]["reason"]  # database text never reaches the client
    ids = sorted(c["id"] for c in app_client.get(P, headers=h).json())
    assert ids == ["a1", "a2"]


def test_unexpected_error_is_json_500_with_cors(make_client, keys, monkeypatch):
    from app.services import papers as svc

    def boom(*a, **k):
        raise RuntimeError("secret detail")

    monkeypatch.setattr(svc, "list_cards", boom)
    client = make_client()
    r = client.get(P, headers={**bearer(keys[0]), "Origin": "http://localhost:8000"})
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "internal", "message": "Something went wrong on the server. Try again."}}
    assert r.headers.get("access-control-allow-origin") == "http://localhost:8000"
    assert "secret" not in r.text


def test_engine_hides_sql_parameters():
    from app.db import make_engine

    assert make_engine("postgresql+psycopg://x@localhost/x").hide_parameters is True


@pytest.fixture()
def supabase_roles(admin_engine):
    with admin_engine.begin() as c:
        for role in ("anon", "authenticated"):
            c.execute(text(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                           f"THEN CREATE ROLE {role} NOLOGIN; END IF; END $$"))


def test_alembic_version_is_closed_to_supabase_api_roles(migrated_db, admin_engine, supabase_roles):
    """Supabase's default privileges open new tables in public to anon and authenticated."""
    from alembic import command
    from alembic.config import Config

    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    cfg = Config(os.path.join(here, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(here, "migrations"))
    cfg.attributes["url"] = migrated_db
    command.downgrade(cfg, "0001")
    with admin_engine.begin() as c:
        c.execute(text("GRANT ALL ON public.alembic_version TO anon, authenticated"))
    command.upgrade(cfg, "head")
    with admin_engine.begin() as c:
        for role in ("anon", "authenticated", "public"):
            for priv in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                assert not c.execute(text("select has_table_privilege(:r, 'public.alembic_version', :p)"),
                                     {"r": role, "p": priv}).scalar(), (role, priv)
        assert c.execute(text("select relrowsecurity from pg_class where oid = 'public.alembic_version'::regclass")).scalar()
