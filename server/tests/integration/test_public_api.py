"""The public library API: read-only, no sign-in, and Postgres decides what is visible."""
import uuid

import pytest
from sqlalchemy import text

A = str(uuid.UUID(int=1))
B = str(uuid.UUID(int=2))
PUB = "/api/v1/public/papers"

ROWS = [
    # owner, id, is_public, deleted, is_sample
    (A, "pub", True, False, False),
    (A, "priv", False, False, False),
    (A, "gone", True, True, False),
    (A, "samp", True, False, True),
    (B, "bpub", True, False, False),
]


@pytest.fixture()
def seeded(admin_engine):
    with admin_engine.begin() as c:
        c.execute(text("insert into journey.users (id, email) values (:a, 'owner-a@example.test'), "
                       "(:b, 'owner-b@example.test')"), {"a": A, "b": B})
        for owner, pid, pub, gone, samp in ROWS:
            c.execute(
                text("insert into journey.papers (user_id, id, title, is_public, is_sample, deleted_at, content, "
                     "body_text) values (:u, :id, :t, :p, :s, case when :g then now() end, "
                     "CAST(:content AS jsonb), :bt)"),
                {"u": owner, "id": pid, "t": "Paper " + pid, "p": pub, "s": samp, "g": gone,
                 "content": '[{"type":"p","text":"hello ' + pid + '"}]', "bt": "hello " + pid},
            )


@pytest.fixture()
def client(make_client, seeded):
    return make_client()


def test_public_list_without_token(client):
    r = client.get(PUB)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert {p["id"] for p in r.json()} == {"pub", "bpub"}
    assert all("sample" not in p and "revision" not in p and "public" not in p for p in r.json())
    assert all(set(p) >= {"owner", "bodyText", "sectionsFilled", "title", "updatedAt"} for p in r.json())
    assert {p["id"]: p["owner"] for p in r.json()} == {"pub": A, "bpub": B}


def test_public_list_is_newest_first(client, admin_engine):
    with admin_engine.begin() as c:
        c.execute(text("update journey.papers set updated_at = now() + interval '1 hour' where id = 'pub'"))
    assert [p["id"] for p in client.get(PUB).json()] == ["pub", "bpub"]


def test_public_list_has_no_email_anywhere(client):
    r = client.get(PUB)
    assert "owner-a@example.test" not in r.text and "owner-b@example.test" not in r.text
    assert "example.test" not in client.get(f"{PUB}/{A}/pub").text


def test_bad_authorization_header_is_ignored(client):
    r = client.get(PUB, headers={"Authorization": "Bearer junk"})
    assert r.status_code == 200
    assert client.get(f"{PUB}/{A}/pub", headers={"Authorization": "Bearer junk"}).status_code == 200


def test_public_get_returns_content(client):
    r = client.get(f"{PUB}/{A}/pub")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["id"] == "pub" and body["owner"] == A
    assert body["content"] == [{"type": "p", "text": "hello pub"}]
    assert "sample" not in body and "revision" not in body and "public" not in body


def test_private_deleted_sample_missing_and_bad_owner_give_identical_404(client):
    urls = [f"{PUB}/{A}/priv", f"{PUB}/{A}/gone", f"{PUB}/{A}/samp", f"{PUB}/{A}/nope",
            f"{PUB}/{B}/pub", f"{PUB}/not-a-uuid/pub"]
    rs = [client.get(u) for u in urls]
    assert [r.status_code for r in rs] == [404] * len(urls)
    assert len({r.content for r in rs}) == 1
    assert rs[0].json() == {"error": {"code": "not_found", "message": "Paper not found."}}
    assert all(r.headers.get("cache-control") == "no-store" for r in rs)


def test_paper_switched_to_private_leaves_the_next_public_list(client, admin_engine):
    assert "pub" in {p["id"] for p in client.get(PUB).json()}
    with admin_engine.begin() as c:
        c.execute(text("update journey.papers set is_public = false where id = 'pub'"))
    assert "pub" not in {p["id"] for p in client.get(PUB).json()}
    assert client.get(f"{PUB}/{A}/pub").status_code == 404


def test_public_rate_limit_per_ip(client):
    codes = [client.get(PUB, headers={"X-Forwarded-For": "x, 5.5.5.5"}).status_code for _ in range(60)]
    assert codes == [200] * 60
    r = client.get(f"{PUB}/{A}/pub", headers={"X-Forwarded-For": "y, 5.5.5.5"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    assert r.headers.get("cache-control") == "no-store"
    assert client.get(PUB, headers={"X-Forwarded-For": "z, 7.7.7.7"}).status_code == 200


def test_public_limit_is_separate_from_the_signed_in_limit(make_client, seeded):
    client = make_client(rate_per_minute=1, public_rate_per_minute=3)
    h = {"X-Forwarded-For": "8.8.8.8"}
    assert [client.get(PUB, headers=h).status_code for _ in range(4)] == [200, 200, 200, 429]


def test_public_routes_are_read_only(client):
    assert client.post(PUB, json={}).status_code == 405
    assert client.delete(f"{PUB}/{A}/pub").status_code == 405
