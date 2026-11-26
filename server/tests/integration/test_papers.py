import pytest

from tests.jwt_helpers import bearer

P = "/api/v1/papers"


@pytest.fixture()
def h(keys):
    return bearer(keys[0])


def new(client, h, pid="p1", **extra):
    body = {"id": pid, "title": "Attention", "content": [{"id": "b1", "type": "p", "text": "Hello"}]}
    body.update(extra)
    r = client.post(P, json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def patch(client, h, pid, rev, body):
    return client.patch(f"{P}/{pid}", json=body, headers={**h, "If-Match": str(rev)})


def test_create_then_get_full(app_client, h):
    created = new(app_client, h)
    assert created["id"] == "p1" and created["revision"] == 1
    r = app_client.get(f"{P}/p1", headers=h)
    assert r.status_code == 200
    got = r.json()
    assert got["revision"] == 1
    assert got["content"] == [{"id": "b1", "type": "p", "text": "Hello"}]
    assert isinstance(got["createdAt"], int) and isinstance(got["updatedAt"], int)
    assert got["year"] == "" and got["sample"] is False


def test_create_cleans_fields(app_client, h):
    got = new(app_client, h, title="  T  ", tags="#Deep Learning, nlp, nlp", rating="9",
              status="weird", link="javascript:x", year=2024)
    assert got["title"] == "T"
    assert got["tags"] == ["deep-learning", "nlp"]
    assert got["rating"] == 5 and got["status"] == "want" and got["link"] == "" and got["year"] == "2024"


def test_create_blank_title_422(app_client, h):
    r = app_client.post(P, json={"title": "   "}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid"


def test_create_existing_id_409(app_client, h):
    new(app_client, h)
    r = app_client.post(P, json={"id": "p1", "title": "Again"}, headers=h)
    assert r.status_code == 409


def test_list_returns_cards_without_content(app_client, h):
    new(app_client, h, content=[{"type": "h2", "text": "Introduction"}, {"type": "p", "text": "Hi <b>there</b>"}])
    r = app_client.get(P, headers=h)
    assert r.status_code == 200
    [card] = r.json()
    assert "content" not in card
    assert card["bodyText"] == "Hi there"
    assert card["sectionsFilled"] == ["intro"]
    assert card["revision"] == 1


def test_list_newest_first(app_client, h):
    new(app_client, h, "a")
    new(app_client, h, "b")
    patch(app_client, h, "a", 1, {"title": "A2"})
    assert [c["id"] for c in app_client.get(P, headers=h).json()] == ["a", "b"]


def test_patch_with_current_revision_bumps_it(app_client, h):
    new(app_client, h, sample=True)
    r = patch(app_client, h, "p1", 1, {"title": "New title"})
    assert r.status_code == 200, r.text
    card = r.json()
    assert card["revision"] == 2 and card["sample"] is False and card["title"] == "New title"
    assert "content" not in card


def test_patch_accepts_quoted_if_match(app_client, h):
    new(app_client, h)
    r = app_client.patch(f"{P}/p1", json={"title": "Q"}, headers={**h, "If-Match": '"1"'})
    assert r.status_code == 200


def test_patch_stale_revision_409_and_unchanged(app_client, h):
    new(app_client, h)
    assert patch(app_client, h, "p1", 1, {"title": "First"}).status_code == 200
    r = patch(app_client, h, "p1", 1, {"title": "Second"})
    assert r.status_code == 409
    body = r.json()
    assert body["error"]["code"] == "conflict"
    assert body["current"]["revision"] == 2 and body["current"]["title"] == "First"
    assert app_client.get(f"{P}/p1", headers=h).json()["title"] == "First"


def test_patch_without_if_match_428(app_client, h):
    new(app_client, h)
    r = app_client.patch(f"{P}/p1", json={"title": "x"}, headers=h)
    assert r.status_code == 428 and r.json()["error"]["code"] == "revision_required"


def test_patch_unknown_block_type_422(app_client, h):
    new(app_client, h)
    r = patch(app_client, h, "p1", 1, {"content": [{"type": "table"}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid"
    assert app_client.get(f"{P}/p1", headers=h).json()["revision"] == 1


def test_patch_sanitizes_inline_html(app_client, h):
    new(app_client, h)
    r = patch(app_client, h, "p1", 1, {"content": [{"id": "b1", "type": "p", "text": "ok<script>alert(1)</script>"}]})
    assert r.status_code == 200
    assert app_client.get(f"{P}/p1", headers=h).json()["content"][0]["text"] == "ok"


def test_patch_content_updates_derived_fields(app_client, h):
    new(app_client, h)
    card = patch(app_client, h, "p1", 1, {"content": [{"type": "h2", "text": "Metode"}, {"type": "p", "text": "m"}]}).json()
    assert card["sectionsFilled"] == ["method"] and card["bodyText"] == "m"


def test_bad_id_is_404(app_client, h):
    assert app_client.get(f"{P}/bad.id", headers=h).status_code == 404
    assert app_client.get(f"{P}/{'x' * 41}", headers=h).status_code == 404


def test_delete_then_restore(app_client, h):
    new(app_client, h)
    assert app_client.delete(f"{P}/p1", headers=h).status_code == 204
    assert app_client.get(f"{P}/p1", headers=h).status_code == 404
    assert patch(app_client, h, "p1", 1, {"title": "x"}).status_code == 404
    assert app_client.get(P, headers=h).json() == []
    r = app_client.post(f"{P}/p1/restore", headers=h)
    assert r.status_code == 200 and r.json()["id"] == "p1"
    assert app_client.get(f"{P}/p1", headers=h).status_code == 200


def test_delete_purges_rows_deleted_over_30_days_ago(app_client, h, admin_engine):
    from sqlalchemy import text

    new(app_client, h, "old")
    new(app_client, h, "now")
    app_client.delete(f"{P}/old", headers=h)
    with admin_engine.begin() as c:
        c.execute(text("update journey.papers set deleted_at = now() - interval '31 days' where id = 'old'"))
    app_client.delete(f"{P}/now", headers=h)
    with admin_engine.connect() as c:
        ids = c.execute(text("select id from journey.papers")).scalars().all()
    assert ids == ["now"]


def test_delete_missing_404(app_client, h):
    assert app_client.delete(f"{P}/nope", headers=h).status_code == 404
    assert app_client.post(f"{P}/nope/restore", headers=h).status_code == 404


def test_delete_samples_only(app_client, h):
    new(app_client, h, "s1", sample=True)
    new(app_client, h, "mine")
    r = app_client.delete(P, params={"sample": "true"}, headers=h)
    assert r.status_code == 200 and r.json() == {"deleted": 1}
    assert [c["id"] for c in app_client.get(P, headers=h).json()] == ["mine"]


def test_wipe_needs_confirm_header(app_client, h):
    new(app_client, h)
    r = app_client.delete(P, headers=h)
    assert r.status_code == 400 and r.json()["error"]["code"] == "confirm_required"
    r = app_client.delete(P, headers={**h, "X-Confirm": "wipe"})
    assert r.status_code == 200 and r.json() == {"deleted": 1}
    assert app_client.get(P, headers=h).json() == []


def test_content_over_8mb_413(app_client, h):
    big = [{"type": "code", "text": "x" * 19000}] * 450  # ~8.6 MB of JSON
    r = app_client.post(P, json={"id": "big", "title": "Big", "content": big}, headers=h)
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"


def test_content_cap_checked_separately_from_body_cap(make_client, keys):
    client = make_client(max_content_bytes=2000)
    h = bearer(keys[0])
    r = client.post(P, json={"id": "big", "title": "Big", "content": [{"type": "code", "text": "x" * 3000}]}, headers=h)
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"
