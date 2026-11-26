"""Rejects request bodies over the limit, whether sent with Content-Length or streamed."""
from __future__ import annotations

import json

from starlette.exceptions import HTTPException

MESSAGE = "The request is too large."


class BodyLimit:
    def __init__(self, app, max_bytes: int):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        length = dict(scope.get("headers") or []).get(b"content-length", b"")
        if length.isdigit() and int(length) > self.max_bytes:
            body = json.dumps({"error": {"code": "too_large", "message": MESSAGE}}).encode()
            await send({"type": "http.response.start", "status": 413,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        seen = 0

        async def limited():
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > self.max_bytes:
                    raise HTTPException(413, MESSAGE)
            return msg

        await self.app(scope, limited, send)
