"""Milestone 2 member API: the Public switch, Make all public, Trash and Delete forever."""
import pytest

from tests.jwt_helpers import bearer

P = "/api/v1/papers"
B_ID = "0b6f1c1e-0000-4000-8000-0000000000bb"


@pytest.fixture()
def client(app_client):
    return app_client


@pytest.fixture()
def a(keys):
    return bearer(keys[0])


@pytest.fixture()
def b(keys):
    return bearer(keys[0], sub=B_ID, email="b@example.test")


def new(client, h, pid, **extra):
    body = {"id": pid, "title": "Paper " + pid, "content": [{"type": "p", "text": "x"}], **extra}
    r = client.post(P, json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def patch(client, h, pid, rev, body):
    return client.patch(f"{P}/{pid}", json=body, headers={**h, "If-Match": str(rev)})


def get(client, h, pid):
    return client.get(f"{P}/{pid}", headers=h)


def forever(client, h, pid, title):
    return client.request("DELETE", f"{P}/{pid}/forever", json={"title": title}, headers=h)


def public_ids(client):
    return {p["id"] for p in client.get("/api/v1/public/papers").json()}


def test_public_round_trips_through_patch(client, a):
    made = new(client, a, "p")
    assert made["public"] is False
    r = patch(client, a, "p", made["revision"], {"public": True})
    assert r.status_code == 200 and r.json()["public"] is True
    assert get(client, a, "p").json()["public"] is True
    assert [c["public"] for c in client.get(P, headers=a).json()] == [True]
    assert public_ids(client) == {"p"}


def test_public_switch_does_not_change_updated_at(client, a):
    made = new(client, a, "p")
    r = patch(client, a, "p", made["revision"], {"public": True})
    assert r.json()["updatedAt"] == made["updatedAt"]
    assert r.json()["revision"] == made["revision"] + 1


def test_create_ignores_public(client, a):
    assert new(client, a, "p", public=True)["public"] is False
    assert public_ids(client) == set()


def test_publish_all_skips_samples_and_deleted(client, a):
    new(client, a, "l1")
    new(client, a, "l2")
    already = new(client, a, "l3")
    patch(client, a, "l3", already["revision"], {"public": True})
    new(client, a, "s", sample=True)
    new(client, a, "d")
    client.delete(f"{P}/d", headers=a)
    r = client.post(f"{P}/publish-all", headers=a)
    assert r.status_code == 200 and r.json() == {"published": 2}
    cards = {c["id"]: c for c in client.get(P, headers=a).json()}
    assert cards["s"]["public"] is False
    assert [t["public"] for t in client.get(f"{P}/trash", headers=a).json()] == [False]
    assert public_ids(client) == {"l1", "l2", "l3"}


def test_publish_all_touches_only_the_callers_papers(client, a, b):
    new(client, a, "mine")
    new(client, b, "theirs")
    assert client.post(f"{P}/publish-all", headers=a).json() == {"published": 1}
    assert get(client, b, "theirs").json()["public"] is False


def test_publish_all_bumps_revision(client, a):
    made = new(client, a, "p")
    client.post(f"{P}/publish-all", headers=a)
    r = patch(client, a, "p", made["revision"], {"title": "stale tab"})
    # Fields retry silently in the client; the server must still say the row moved on.
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert r.json()["current"]["public"] is True


def test_publish_all_needs_sign_in(client):
    assert client.post(f"{P}/publish-all").status_code == 401


def test_trash_lists_only_the_callers_deleted(client, a, b):
    new(client, a, "x")
    new(client, a, "live")
    new(client, b, "y")
    client.delete(f"{P}/x", headers=a)
    client.delete(f"{P}/y", headers=b)
    r = client.get(f"{P}/trash", headers=a)
    assert r.status_code == 200
    [row] = r.json()
    assert row["id"] == "x" and isinstance(row["deletedAt"], int) and "content" not in row


def test_trash_is_newest_deletion_first(client, a, admin_engine):
    from sqlalchemy import text
    for pid in ("old", "new"):
        new(client, a, pid)
        client.delete(f"{P}/{pid}", headers=a)
    with admin_engine.begin() as c:
        c.execute(text("update journey.papers set deleted_at = now() - interval '2 days' where id = 'old'"))
    assert [t["id"] for t in client.get(f"{P}/trash", headers=a).json()] == ["new", "old"]


def test_trash_route_is_not_a_paper_id(client, a):
    new(client, a, "trash")
    r = client.get(f"{P}/trash", headers=a)
    assert r.status_code == 200 and r.json() == []


def test_forever_needs_trash(client, a):
    new(client, a, "p")
    r = forever(client, a, "p", "Paper p")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_in_trash"
    assert get(client, a, "p").status_code == 200


@pytest.mark.parametrize("typed", ["Paper p ", "PAPER P", "paper p", "", "Paper"])
def test_forever_needs_exact_title(client, a, typed):
    new(client, a, "p")
    client.delete(f"{P}/p", headers=a)
    r = forever(client, a, "p", typed)
    assert r.status_code == 400 and r.json()["error"]["code"] == "title_mismatch"
    assert [t["id"] for t in client.get(f"{P}/trash", headers=a).json()] == ["p"]


def test_forever_without_a_title_is_rejected(client, a):
    new(client, a, "p")
    client.delete(f"{P}/p", headers=a)
    r = client.request("DELETE", f"{P}/p/forever", headers=a)
    assert r.status_code == 422
    assert [t["id"] for t in client.get(f"{P}/trash", headers=a).json()] == ["p"]


def test_delete_forever_matches_the_title_after_nfc_only(client, a):
    new(client, a, "p", title="Café notes")  # stored decomposed (NFD)
    client.delete(f"{P}/p", headers=a)
    assert forever(client, a, "p", "Café notes").status_code == 204  # typed composed (NFC)
    assert client.get(f"{P}/trash", headers=a).json() == []
    assert client.post(f"{P}/p/restore", headers=a).status_code == 404


def test_forever_unknown_paper_is_404(client, a):
    assert forever(client, a, "nope", "x").status_code == 404


def test_other_member_cannot_restore_or_delete_forever(client, a, b):
    new(client, a, "p")
    client.delete(f"{P}/p", headers=a)
    assert forever(client, b, "p", "Paper p").status_code == 404
    assert client.post(f"{P}/p/restore", headers=b).status_code == 404
    assert [t["id"] for t in client.get(f"{P}/trash", headers=a).json()] == ["p"]


def test_restore_keeps_the_public_switch(client, a):
    made = new(client, a, "p")
    patch(client, a, "p", made["revision"], {"public": True})
    client.delete(f"{P}/p", headers=a)
    r = client.post(f"{P}/p/restore", headers=a)
    assert r.status_code == 200 and r.json()["public"] is True
    assert public_ids(client) == {"p"}


def test_deleted_paper_leaves_public_list(client, a):
    made = new(client, a, "p")
    patch(client, a, "p", made["revision"], {"public": True})
    assert public_ids(client) == {"p"}
    client.delete(f"{P}/p", headers=a)
    assert public_ids(client) == set()
