from __future__ import annotations

from fastapi import APIRouter, Request
from sqlalchemy import text

from app.db import plain_tx

router = APIRouter()


@router.get("/health")
def health(request: Request) -> dict:
    """Runs SELECT 1, so the daily keep-alive ping also keeps Supabase awake."""
    with plain_tx(request.app.state.engine) as conn:
        conn.execute(text("select 1"))
    return {"ok": True}
