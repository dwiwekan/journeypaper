"""FastAPI app factory: routers, CORS, request ids, JSON logs, error shape."""
from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import data, health, me, papers, public
from app.bodylimit import BodyLimit
from app.config import Settings, get_settings
from app.db import make_engine
from app.errors import ApiError, api_error
from app.ratelimit import RateLimiter
from app.services.errors import ServiceError

log = logging.getLogger("journey")
if not log.handlers:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(h)
    log.setLevel(logging.INFO)
    log.propagate = False

API = "/api/v1"
PUBLIC = API + "/public/"


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        app.state.engine.dispose()

    app = FastAPI(title="JourneyPaper API", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = make_engine(settings.database_url)
    app.state.limiter = RateLimiter(settings.rate_per_minute)
    app.state.public_limiter = RateLimiter(settings.public_rate_per_minute)
    app.state.keys = None  # RemoteJwks, made on first use (app.deps.get_key_source)

    # Added first so it sits inside the request log and CORS: its 413s are logged and get CORS headers.
    app.add_middleware(BodyLimit, max_bytes=settings.max_body_bytes)

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        # One JSON line per request. Never log headers or bodies (tokens, notes).
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = rid
        request.state.user_id = None
        start = time.perf_counter()
        status = 500
        try:
            try:
                response = await call_next(request)
            except Exception as e:  # noqa: BLE001 - last resort, inside CORS so the browser can read it
                log.error(json.dumps({"request_id": rid, "error": type(e).__name__}))
                response = api_error(500, "internal", "Something went wrong on the server. Try again.")
            status = response.status_code
            response.headers["X-Request-Id"] = rid
            if request.url.path.startswith(PUBLIC):
                # Visitors' answers (200, 404, 429 alike) are never cached by a browser or proxy.
                response.headers["Cache-Control"] = "no-store"
            return response
        finally:
            route = request.scope.get("route")
            log.info(json.dumps({
                "request_id": rid,
                "method": request.method,
                "path": getattr(route, "path", request.url.path),
                "status": status,
                "ms": round((time.perf_counter() - start) * 1000, 1),
                "user_id": request.state.user_id,
            }))

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "If-Match", "X-Confirm", "X-Request-Id"],
        expose_headers=["X-Request-Id"],
        max_age=600,
    )

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        return api_error(e.status, e.code, e.message, **e.extra)

    @app.exception_handler(ServiceError)
    async def _service_error(_: Request, e: ServiceError):
        return api_error(e.status, e.code, e.message, **e.extra)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, e: StarletteHTTPException):
        code = {400: "bad_request", 401: "unauthorized", 404: "not_found", 405: "method_not_allowed",
                413: "too_large"}.get(e.status_code, "error")
        return api_error(e.status_code, code, str(e.detail))

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        where = ".".join(str(x) for x in first.get("loc", []))
        return api_error(422, "invalid", f"{where}: {first.get('msg', 'invalid request')}")

    app.include_router(health.router, prefix=API)
    app.include_router(me.router, prefix=API)
    app.include_router(papers.router, prefix=API)
    app.include_router(data.router, prefix=API)
    app.include_router(public.router, prefix=API)
    return app
