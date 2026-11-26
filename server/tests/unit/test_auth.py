import time

import pytest

from app.config import Settings
from app.deps import AuthError, verify_token
from tests.jwt_helpers import SUPABASE, make_keys, sign, sign_hs256_with_public_key


@pytest.fixture()
def cfg():
    return Settings(database_url="postgresql+psycopg://x@localhost/x", supabase_url=SUPABASE)


def test_valid_token_returns_claims(cfg):
    priv, keys = make_keys()
    sub = "0b6f1c1e-0000-4000-8000-000000000001"
    c = verify_token(sign(priv, sub=sub, email="a@b.c"), keys, cfg)
    assert c.sub == sub and c.email == "a@b.c"


def test_expired_token_rejected(cfg):
    priv, keys = make_keys()
    with pytest.raises(AuthError):
        verify_token(sign(priv, exp=int(time.time()) - 120), keys, cfg)


def test_wrong_audience_rejected(cfg):
    priv, keys = make_keys()
    with pytest.raises(AuthError):
        verify_token(sign(priv, aud="anon"), keys, cfg)


def test_wrong_issuer_rejected(cfg):
    priv, keys = make_keys()
    with pytest.raises(AuthError):
        verify_token(sign(priv, iss="https://evil.example/auth/v1"), keys, cfg)


def test_wrong_signature_rejected(cfg):
    _, keys = make_keys()
    other, _ = make_keys()
    with pytest.raises(AuthError):
        verify_token(sign(other), keys, cfg)


def test_hs256_token_rejected(cfg):
    _, keys = make_keys()
    with pytest.raises(AuthError):
        verify_token(sign_hs256_with_public_key(keys.public_key), keys, cfg)


def test_non_uuid_subject_rejected(cfg):
    priv, keys = make_keys()
    with pytest.raises(AuthError):
        verify_token(sign(priv, sub="not-a-uuid"), keys, cfg)


def test_garbage_token_rejected(cfg):
    _, keys = make_keys()
    with pytest.raises(AuthError):
        verify_token("abc.def", keys, cfg)


def test_anonymous_token_rejected(cfg):
    priv, keys = make_keys()
    with pytest.raises(AuthError):
        verify_token(sign(priv, is_anonymous=True), keys, cfg)
