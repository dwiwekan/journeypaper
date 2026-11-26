from sqlalchemy import text

from tests.jwt_helpers import USER_B, bearer

P = "/api/v1/papers"


def test_user_b_paper_is_404_for_user_a_on_every_id_route(app_client, keys, admin_engine):
    a, b = bearer(keys[0]), bearer(keys[0], USER_B)
    assert app_client.post(P, json={"id": "bp", "title": "B's"}, headers=b).status_code == 201
    assert app_client.get(f"{P}/bp", headers=a).status_code == 404
    assert app_client.patch(f"{P}/bp", json={"title": "pwned"}, headers={**a, "If-Match": "1"}).status_code == 404
    assert app_client.delete(f"{P}/bp", headers=a).status_code == 404
    assert app_client.post(f"{P}/bp/restore", headers=a).status_code == 404
    with admin_engine.connect() as c:
        row = c.execute(text("select title, revision, deleted_at from journey.papers where id = 'bp'")).one()
    assert tuple(row) == ("B's", 1, None)
    assert app_client.get(P, headers=a).json() == []
    assert app_client.get("/api/v1/export", headers=a).json() == []
    assert app_client.delete(P, headers={**a, "X-Confirm": "wipe"}).json() == {"deleted": 0}
    assert app_client.get(f"{P}/bp", headers=b).status_code == 200


def test_same_id_for_two_users_is_two_papers(app_client, keys):
    a, b = bearer(keys[0]), bearer(keys[0], USER_B)
    assert app_client.post(P, json={"id": "shared", "title": "A title"}, headers=a).status_code == 201
    assert app_client.post(P, json={"id": "shared", "title": "B title"}, headers=b).status_code == 201
    assert app_client.get(f"{P}/shared", headers=a).json()["title"] == "A title"
    assert app_client.get(f"{P}/shared", headers=b).json()["title"] == "B title"
