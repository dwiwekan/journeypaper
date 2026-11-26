"""journey.users queries."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

_UPSERT = text(
    """
    INSERT INTO journey.users (id, email, role) VALUES (CAST(:id AS uuid), :email, :role)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role
    WHERE journey.users.email IS DISTINCT FROM EXCLUDED.email
       OR journey.users.role IS DISTINCT FROM EXCLUDED.role
    """
)


def upsert(conn: Connection, user_id: str, email: str, role: str) -> None:
    conn.execute(_UPSERT, {"id": user_id, "email": email, "role": role})
