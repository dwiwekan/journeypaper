"""journey.papers as a visitor sees it. Runs inside public_tx (role journey_public).

There is deliberately no WHERE on is_public, deleted_at or is_sample: the public_read policy
hides every other row, and journey_public cannot even read those columns.
"""
from __future__ import annotations

from typing import Mapping, Optional

from sqlalchemy import text
from sqlalchemy.engine import Connection

COLS = (
    "user_id, id, title, image, link, authors, year, venue, tags, status, rating, summary, "
    "body_text, sections_filled, created_at, updated_at"
)


def list_cards(conn: Connection) -> list:
    return conn.execute(
        text(f"SELECT {COLS} FROM journey.papers ORDER BY updated_at DESC, created_at DESC")
    ).mappings().all()


def get(conn: Connection, owner: str, pid: str) -> Optional[Mapping]:
    return conn.execute(
        text(f"SELECT {COLS}, content FROM journey.papers WHERE user_id = CAST(:owner AS uuid) AND id = :id"),
        {"owner": owner, "id": pid},
    ).mappings().first()
