"""Test-only ES256 keys and tokens shaped like Supabase Auth's."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any, Tuple

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

SUPABASE = "https://test.supabase.co"
ISSUER = SUPABASE + "/auth/v1"


class StaticKeys:
    """A KeySource holding one public key, used in place of the remote JWKS."""

    def __init__(self, public_key: Any):
        self.public_key = public_key

    def key_for(self, token: str) -> Any:
        return self.public_key


def make_keys() -> Tuple[Any, StaticKeys]:
    private = ec.generate_private_key(ec.SECP256R1())
    return private, StaticKeys(private.public_key())


def claims(**overrides: Any) -> dict:
    now = int(time.time())
    body = {
        "sub": str(uuid.uuid4()),
        "email": "reader@example.com",
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "iat": now,
        "exp": now + 3600,
    }
    body.update(overrides)
    return body


def sign(private_key: Any, **overrides: Any) -> str:
    return jwt.encode(claims(**overrides), private_key, algorithm="ES256", headers={"kid": "test"})


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign_hs256_with_public_key(public_key: Any, **overrides: Any) -> str:
    """The algorithm-confusion attack: HMAC keyed with the public key's PEM bytes."""
    secret = public_key.public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    head = _b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": "test"}).encode())
    body = _b64(json.dumps(claims(**overrides)).encode())
    sig = hmac.new(secret, f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{_b64(sig)}"


USER_A = "0b6f1c1e-0000-4000-8000-00000000000a"
USER_B = "0b6f1c1e-0000-4000-8000-00000000000b"


def bearer(private_key: Any, sub: str = USER_A, email: str = "") -> dict:
    email = email or f"{sub[-1]}@example.com"
    return {"Authorization": "Bearer " + sign(private_key, sub=sub, email=email)}
