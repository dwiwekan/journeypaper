"""The public library: read-only views of public papers, for visitors who are not signed in."""
from __future__ import annotations

import uuid
from typing import List, Mapping

from sqlalchemy.engine import Engine

from app.blocks.content import mask_to_keys
from app.db import public_tx
from app.repos import public as repo
from app.services.errors import not_found
from app.services.papers import _common


def public_card_json(r: Mapping) -> dict:
    return {**_common(r), "bodyText": r["body_text"], "sectionsFilled": mask_to_keys(r["sections_filled"]),
            "owner": str(r["user_id"])}


def list_public(engine: Engine) -> List[dict]:
    with public_tx(engine) as conn:
        return [public_card_json(r) for r in repo.list_cards(conn)]


def get_public(engine: Engine, owner: str, pid: str) -> dict:
    """Private, deleted, sample and missing papers, and a bad owner id, all give the same 404."""
    try:
        owner = str(uuid.UUID(owner))
    except ValueError:
        raise not_found()
    with public_tx(engine) as conn:
        row = repo.get(conn, owner, pid)
    if row is None:
        raise not_found()
    return {**public_card_json(row), "content": row["content"]}
