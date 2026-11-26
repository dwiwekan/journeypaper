"""journey.papers queries. Every function filters on user_id; RLS checks it again."""
from __future__ import annotations

from typing import Iterator, Mapping, Optional

from sqlalchemy import text
from sqlalchemy.engine import Connection

T = "journey.papers"
CARD = (
    "id, title, image, link, authors, year, venue, tags, status, rating, summary, "
    "body_text, sections_filled, is_sample, is_public, revision, created_at, updated_at"
)
FULL = CARD + ", content"
OWN = "user_id = CAST(:user_id AS uuid) AND id = :id"
LIVE = "deleted_at IS NULL"

# Columns a write may set, and how each value is bound.
_BIND = {
    "title": ":title", "image": ":image", "link": ":link", "authors": ":authors", "year": ":year",
    "venue": ":venue", "tags": "CAST(:tags AS text[])", "status": ":status", "rating": ":rating",
    "summary": ":summary", "content": "CAST(:content AS jsonb)", "body_text": ":body_text",
    "sections_filled": ":sections_filled",
}
_INSERT_COLS = list(_BIND) + ["is_sample", "created_at", "updated_at"]
_INSERT = (
    f"INSERT INTO {T} (user_id, id, {', '.join(_INSERT_COLS)}) "
    f"VALUES (CAST(:user_id AS uuid), :id, {', '.join(_BIND.get(c, ':' + c) for c in _INSERT_COLS)})"
)


def list_cards(conn: Connection, user_id: str) -> list:
    return conn.execute(
        text(f"SELECT {CARD} FROM {T} WHERE user_id = CAST(:user_id AS uuid) AND {LIVE} "
             "ORDER BY updated_at DESC, created_at DESC"),
        {"user_id": user_id},
    ).mappings().all()


def get(conn: Connection, user_id: str, pid: str) -> Optional[Mapping]:
    return conn.execute(
        text(f"SELECT {FULL} FROM {T} WHERE {OWN} AND {LIVE}"), {"user_id": user_id, "id": pid}
    ).mappings().first()


def insert(conn: Connection, user_id: str, row: dict) -> Optional[Mapping]:
    """Inserts a new paper; None when this user already has the id."""
    return conn.execute(
        text(f"{_INSERT} ON CONFLICT (user_id, id) DO NOTHING RETURNING {FULL}"),
        {**row, "user_id": user_id},
    ).mappings().first()


def update_if_revision(conn: Connection, user_id: str, pid: str, revision: int, fields: dict) -> Optional[Mapping]:
    """Applies fields only if the stored revision matches; None otherwise (or if missing).
    is_public is set only here (never on insert or import). Flipping it alone is not an edit,
    so updated_at stays; the revision still moves so other tabs see the change."""
    sets = "".join(f"{c} = {_BIND.get(c, ':' + c)}, " for c in fields)
    edited = "" if set(fields) <= {"is_public"} else "updated_at = date_trunc('milliseconds', now()), "
    return conn.execute(
        text(f"UPDATE {T} SET {sets}{edited}revision = revision + 1, is_sample = false "
             f"WHERE {OWN} AND {LIVE} AND revision = :expected RETURNING {CARD}"),
        {**fields, "user_id": user_id, "id": pid, "expected": revision},
    ).mappings().first()


def soft_delete(conn: Connection, user_id: str, pid: str) -> bool:
    r = conn.execute(
        text(f"UPDATE {T} SET deleted_at = now() WHERE {OWN} AND {LIVE}"), {"user_id": user_id, "id": pid}
    )
    return r.rowcount == 1


def restore(conn: Connection, user_id: str, pid: str) -> Optional[Mapping]:
    return conn.execute(
        text(f"UPDATE {T} SET deleted_at = NULL WHERE {OWN} RETURNING {CARD}"), {"user_id": user_id, "id": pid}
    ).mappings().first()


def purge_deleted(conn: Connection, user_id: str, days: int = 30) -> int:
    return conn.execute(
        text(f"DELETE FROM {T} WHERE user_id = CAST(:user_id AS uuid) "
             "AND deleted_at < now() - make_interval(days => :days)"),
        {"user_id": user_id, "days": days},
    ).rowcount


def delete_samples(conn: Connection, user_id: str) -> int:
    return conn.execute(
        text(f"DELETE FROM {T} WHERE user_id = CAST(:user_id AS uuid) AND is_sample"), {"user_id": user_id}
    ).rowcount


def delete_all(conn: Connection, user_id: str) -> int:
    return conn.execute(
        text(f"DELETE FROM {T} WHERE user_id = CAST(:user_id AS uuid)"), {"user_id": user_id}
    ).rowcount


def iter_full(conn: Connection, user_id: str) -> Iterator[Mapping]:
    """Live papers one at a time through a server-side cursor, so export memory stays flat."""
    result = conn.execution_options(stream_results=True, yield_per=20).execute(
        text(f"SELECT {FULL} FROM {T} WHERE user_id = CAST(:user_id AS uuid) AND {LIVE} ORDER BY created_at"),
        {"user_id": user_id},
    )
    for row in result.mappings():
        yield row


def upsert_import(conn: Connection, user_id: str, row: dict) -> str:
    """'created', 'updated' (incoming updated_at is later), or 'skipped'. Never deletes.
    A row brought back from the Trash comes back private: an import never publishes."""
    sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in _INSERT_COLS)
    hit = conn.execute(
        text(f"{_INSERT} ON CONFLICT (user_id, id) DO UPDATE SET {sets}, "
             f"revision = {T}.revision + 1, deleted_at = NULL, "
             f"is_public = {T}.is_public AND {T}.deleted_at IS NULL "
             f"WHERE {T}.updated_at < EXCLUDED.updated_at RETURNING (xmax = 0) AS inserted"),
        {**row, "user_id": user_id},
    ).first()
    if hit is None:
        return "skipped"
    return "created" if hit.inserted else "updated"


def get_any(conn: Connection, user_id: str, pid: str) -> Optional[Mapping]:
    """The row whether or not it is in the Trash."""
    return conn.execute(
        text(f"SELECT id, title, deleted_at FROM {T} WHERE {OWN}"), {"user_id": user_id, "id": pid}
    ).mappings().first()


def hard_delete(conn: Connection, user_id: str, pid: str) -> bool:
    """Removes a row that is in the Trash. Live rows are never touched."""
    return conn.execute(
        text(f"DELETE FROM {T} WHERE {OWN} AND deleted_at IS NOT NULL"), {"user_id": user_id, "id": pid}
    ).rowcount == 1


def list_trash(conn: Connection, user_id: str) -> list:
    return conn.execute(
        text(f"SELECT {CARD}, deleted_at FROM {T} WHERE user_id = CAST(:user_id AS uuid) "
             "AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id"),
        {"user_id": user_id},
    ).mappings().all()


def publish_all(conn: Connection, user_id: str) -> int:
    """Makes every live, non-sample paper public. Bumps revision (open tabs must see a conflict)
    but not updated_at (nothing in the paper was edited)."""
    return conn.execute(
        text(f"UPDATE {T} SET is_public = true, revision = revision + 1 "
             f"WHERE user_id = CAST(:user_id AS uuid) AND {LIVE} AND NOT is_sample AND NOT is_public"),
        {"user_id": user_id},
    ).rowcount
