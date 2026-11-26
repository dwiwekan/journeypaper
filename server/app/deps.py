"""Authentication: verify Supabase access tokens and resolve the current user.

All auth logic lives here (ARCHITECTURE.md section 9). Tokens are ES256 JWTs
signed by Supabase Auth; public keys come from the project's JWKS.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Protocol

import jwt
from fastapi import Depends, Request
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db import user_tx
from app.errors import ApiError
from app.repos import users


class AuthError(Exception):
    """The token is missing, malformed, expired, or not ours."""


class KeysUnavailable(Exception):
    """The JWKS could not be fetched. Not the caller's fault, so not a 401."""


class KeySource(Protocol):
    def key_for(self, token: str) -> Any: ...


class RemoteJwks:
    """The project's JWKS, cached for an hour; PyJWKClient refetches on an unknown kid."""

    def __init__(self, url: str):
        self.client = jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)

    def key_for(self, token: str) -> Any:
        return self.client.get_signing_key_from_jwt(token).key


@dataclass(frozen=True)
class Claims:
    sub: str
    email: str


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str
    is_admin: bool

    @property
    def role(self) -> str:
        return "admin" if self.is_admin else "member"


def verify_token(token: str, keys: KeySource, settings: Settings) -> Claims:
    try:
        data = jwt.decode(
            token,
            keys.key_for(token),
            algorithms=["ES256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            leeway=30,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
        sub = str(uuid.UUID(str(data["sub"])))
    except jwt.PyJWKClientConnectionError as e:
        raise KeysUnavailable(str(e)) from e
    except (jwt.PyJWTError, ValueError, KeyError, TypeError) as e:
        raise AuthError(str(e)) from e
    if data.get("is_anonymous"):
        raise AuthError("anonymous sign-ins are not accepted")
    return Claims(sub=sub, email=str(data.get("email") or ""))


def get_key_source(request: Request) -> KeySource:
    state = request.app.state
    if getattr(state, "keys", None) is None:
        state.keys = RemoteJwks(state.settings.jwks_url)
    return state.keys


def client_ip(request: Request, hops: int) -> str:
    """The caller's address for rate limits. Each trusted proxy appends the address it saw to
    X-Forwarded-For (Cloud Run appends exactly one), so the entry `hops` from the right is the
    caller; whatever the caller put in front is ignored."""
    entries = [e.strip() for e in request.headers.get("x-forwarded-for", "").split(",") if e.strip()]
    if hops >= 1 and len(entries) >= hops:
        return entries[-hops]
    return request.client.host if request.client else "unknown"


def public_limit(request: Request) -> None:
    """Per-IP limit for the public library, separate from the signed-in limit."""
    state = request.app.state
    if not state.public_limiter.check("ip:" + client_ip(request, state.settings.xff_hops)):
        raise ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.")


def current_user(request: Request, keys: KeySource = Depends(get_key_source)) -> CurrentUser:
    state = request.app.state
    settings: Settings = state.settings
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    try:
        if scheme.lower() != "bearer" or not token.strip():
            raise AuthError("missing bearer token")
        claims = verify_token(token.strip(), keys, settings)
    except KeysUnavailable:
        raise ApiError(503, "auth_unavailable", "Sign-in checks are unavailable. Try again soon.")
    except AuthError:
        if not state.limiter.check("ip:" + client_ip(request, settings.xff_hops)):
            raise ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.")
        raise ApiError(401, "unauthorized", "Sign in again.")
    if not state.limiter.check("user:" + claims.sub):
        raise ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.")
    admins = {e.lower() for e in settings.admin_emails}
    user = CurrentUser(id=claims.sub, email=claims.email, is_admin=claims.email.lower() in admins)
    try:
        with user_tx(state.engine, user.id) as conn:
            users.upsert(conn, user.id, user.email, user.role)
    except IntegrityError:
        # Another account row has this email: the Supabase user was deleted and made again.
        raise ApiError(409, "account_conflict",
                       "This account was re-created. Ask the admin to move your papers to it.")
    request.state.user_id = user.id
    return user
