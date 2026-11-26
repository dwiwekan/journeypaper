from sqlalchemy import text

from tests.jwt_helpers import sign


def test_me_requires_token(app_client):
    r = app_client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_me_rejects_bad_token(app_client):
    r = app_client.get("/api/v1/me", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_me_creates_user_row(app_client, keys, admin_engine):
    sub = "0b6f1c1e-0000-4000-8000-0000000000a1"
    tok = sign(keys[0], sub=sub, email="reader@example.com")
    r = app_client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json() == {"id": sub, "email": "reader@example.com", "role": "member"}
    app_client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    with admin_engine.connect() as c:
        rows = c.execute(text("select id::text, email from journey.users")).all()
    assert rows == [(sub, "reader@example.com")]


def test_me_marks_admin_from_env(make_client, keys):
    client = make_client(admin_emails=["Owner@Example.com"])
    tok = sign(keys[0], email="owner@example.com")
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_rate_limit_returns_429(make_client, keys):
    client = make_client(rate_per_minute=3)
    h = {"Authorization": f"Bearer {sign(keys[0])}"}
    codes = [client.get("/api/v1/me", headers=h).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    assert client.get("/api/v1/me", headers=h).json()["error"]["code"] == "rate_limited"


def test_bad_tokens_are_rate_limited_by_ip(make_client):
    client = make_client(rate_per_minute=2)
    codes = [client.get("/api/v1/me", headers={"Authorization": "Bearer x"}).status_code for _ in range(3)]
    assert codes == [401, 401, 429]


def test_recreated_account_with_same_email_gets_a_clear_409(app_client, keys):
    old = "0b6f1c1e-0000-4000-8000-0000000000b1"
    new = "0b6f1c1e-0000-4000-8000-0000000000b2"
    first = app_client.get("/api/v1/me", headers={"Authorization": f"Bearer {sign(keys[0], sub=old, email='same@example.com')}"})
    assert first.status_code == 200
    r = app_client.get("/api/v1/me", headers={"Authorization": f"Bearer {sign(keys[0], sub=new, email='same@example.com')}"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "account_conflict"


def test_anonymous_token_is_rejected(app_client, keys):
    tok = sign(keys[0], is_anonymous=True, email="")
    r = app_client.get("/api/v1/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401


def test_jwks_outage_is_503_not_signed_out(make_client, keys):
    import jwt

    from app.deps import get_key_source

    class Down:
        def key_for(self, token):
            raise jwt.PyJWKClientConnectionError("Fail to fetch data from the url")

    client = make_client()
    client.app.dependency_overrides[get_key_source] = lambda: Down()
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {sign(keys[0])}"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "auth_unavailable"
