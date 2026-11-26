import json

from tests.jwt_helpers import bearer

P = "/api/v1/papers"
T0 = 1_700_000_000_123


def item(pid, title="T", updated=T0, **extra):
    d = {"id": pid, "title": title, "createdAt": T0, "updatedAt": updated,
         "content": [{"id": "b1", "type": "p", "text": "hi"}]}
    d.update(extra)
    return d


def imp(client, h, body):
    r = client.post("/api/v1/import", json=body, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_import_bare_array_keeps_ids(app_client, keys):
    h = bearer(keys[0])
    out = imp(app_client, h, [item("keep-me-1"), item("keep-me-2")])
    assert out == {"created": 2, "updated": 0, "skipped": 0, "errors": []}
    got = app_client.get(f"{P}/keep-me-1", headers=h).json()
    assert got["createdAt"] == T0 and got["updatedAt"] == T0


def test_import_object_with_papers_key(app_client, keys):
    h = bearer(keys[0])
    assert imp(app_client, h, {"papers": [item("x1")]})["created"] == 1


def test_import_skips_items_without_title(app_client, keys):
    h = bearer(keys[0])
    out = imp(app_client, h, [item("x1"), {"id": "x2", "title": " "}, "junk"])
    assert out["created"] == 1 and out["skipped"] == 2


def test_import_rejects_other_shapes(app_client, keys):
    r = app_client.post("/api/v1/import", json={"nope": 1}, headers=bearer(keys[0]))
    assert r.status_code == 422


def test_import_is_idempotent(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [item("a"), item("b")])
    assert imp(app_client, h, [item("a"), item("b")]) == {"created": 0, "updated": 0, "skipped": 2, "errors": []}


def test_import_of_own_export_is_idempotent(app_client, keys):
    h = bearer(keys[0])
    app_client.post(P, json={"id": "e1", "title": "E"}, headers=h)
    exported = app_client.get("/api/v1/export", headers=h).json()
    assert imp(app_client, h, exported)["skipped"] == 1


def test_import_newer_copy_updates(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [item("a", "Old")])
    out = imp(app_client, h, [item("a", "New", updated=T0 + 1)])
    assert out["updated"] == 1
    got = app_client.get(f"{P}/a", headers=h).json()
    assert got["title"] == "New" and got["revision"] == 2


def test_import_keeps_the_newer_server_copy(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [item("a", "Old")])
    app_client.patch(f"{P}/a", json={"title": "Edited online"}, headers={**h, "If-Match": "1"})
    out = imp(app_client, h, [item("a", "Stale local copy", updated=T0 + 5)])
    assert out["skipped"] == 1 and out["updated"] == 0
    assert app_client.get(f"{P}/a", headers=h).json()["title"] == "Edited online"


def test_import_newer_copy_restores_deleted(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [item("a")])
    app_client.delete(f"{P}/a", headers=h)
    assert imp(app_client, h, [item("a", updated=T0 + 1)])["updated"] == 1
    assert app_client.get(f"{P}/a", headers=h).status_code == 200


def test_import_never_deletes(app_client, keys):
    h = bearer(keys[0])
    app_client.post(P, json={"id": "online-only", "title": "Mine"}, headers=h)
    imp(app_client, h, [item("other")])
    assert sorted(c["id"] for c in app_client.get(P, headers=h).json()) == ["online-only", "other"]


def test_import_unknown_block_becomes_p(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [item("a", content=[{"id": "t", "type": "table", "text": "cell"}])])
    assert app_client.get(f"{P}/a", headers=h).json()["content"] == [{"id": "t", "type": "p", "text": "cell"}]


def test_import_legacy_notes_become_content(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [{"id": "old", "title": "Old", "notes": "line1\nline<2>"}])
    content = app_client.get(f"{P}/old", headers=h).json()["content"]
    assert content[-2]["text"] == "Notes"
    assert content[-1]["text"] == "line1<br>line&lt;2&gt;"


def test_import_of_an_oversized_paper_is_reported_others_kept(make_client, keys):
    client = make_client(max_content_bytes=2000)
    h = bearer(keys[0])
    big = item("big", content=[{"type": "code", "text": "x" * 3000}])
    out = imp(client, h, [item("small"), big, {"id": "x" * 41, "title": "x"}])
    assert out["created"] == 1
    assert [e["id"] for e in out["errors"]] == ["big", "x" * 41]
    assert all(e["reason"] for e in out["errors"])
    assert [c["id"] for c in client.get(P, headers=h).json()] == ["small"]


def test_export_streams_a_json_array(app_client, keys, monkeypatch):
    import app.api.data as data_api

    seen = []
    real = data_api.StreamingResponse

    def spy(*a, **k):
        resp = real(*a, **k)
        seen.append(resp)
        return resp

    monkeypatch.setattr(data_api, "StreamingResponse", spy)
    h = bearer(keys[0])
    imp(app_client, h, [item("a"), item("b")])
    r = app_client.get("/api/v1/export", headers=h)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    papers = json.loads(r.text)
    assert sorted(p["id"] for p in papers) == ["a", "b"]
    assert papers[0]["content"] == [{"id": "b1", "type": "p", "text": "hi"}]
    assert len(seen) == 1


def test_import_is_always_private(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [item("n", public=True)])
    assert app_client.get(f"{P}/n", headers=h).json()["public"] is False
    assert app_client.get("/api/v1/public/papers").json() == []


def test_import_keeps_existing_public_value(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [item("e")])
    rev = app_client.get(f"{P}/e", headers=h).json()["revision"]
    app_client.patch(f"{P}/e", json={"public": True}, headers={**h, "If-Match": str(rev)})
    assert imp(app_client, h, [item("e", updated=T0 - 1000, public=False)])["skipped"] == 1
    assert imp(app_client, h, [item("e", title="newer", updated=T0 + 10**9, public=False)])["updated"] == 1
    got = app_client.get(f"{P}/e", headers=h).json()
    assert got["title"] == "newer" and got["public"] is True


def test_export_includes_public(app_client, keys):
    h = bearer(keys[0])
    imp(app_client, h, [item("x"), item("y")])
    rev = app_client.get(f"{P}/x", headers=h).json()["revision"]
    app_client.patch(f"{P}/x", json={"public": True}, headers={**h, "If-Match": str(rev)})
    rows = json.loads(app_client.get("/api/v1/export", headers=h).content)
    assert {r["id"]: r["public"] for r in rows} == {"x": True, "y": False}
