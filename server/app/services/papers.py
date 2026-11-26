"""Paper rules: field cleanup, revisions, soft delete, import and export.

Field cleanup mirrors normalizePaper and normTags in web/js/data/paper.js.
Services open their own user_tx and never import FastAPI.
"""
from __future__ import annotations

import html
import json
import re
import time
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator, List, Mapping, Optional

from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError

from app.blocks.content import ContentError, derive, mask_to_keys, norm_blocks, safe_href, safe_img
from app.db import user_tx
from app.repos import papers as repo
from app.services.errors import ServiceError, invalid, not_found, too_large

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
STATUS = ("want", "reading", "done")
MAX_TAGS = 12
SECTION_TITLES = ["Introduction", "Related Work", "Method", "Experiment Results", "Conclusion"]
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_MS = timedelta(milliseconds=1)
_MAX_MS = 253_402_300_799_999  # 9999-12-31


# ---------- time ----------
def to_ms(dt: datetime) -> int:
    return (dt - EPOCH) // _MS


def from_ms(ms: int) -> datetime:
    return EPOCH + ms * _MS


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def _ms_or_now(v: Any) -> int:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return now_ms()
    return int(f) if 0 < f < _MAX_MS else now_ms()


# ---------- JSON out ----------
def _common(r: Mapping) -> dict:
    """The fields a visitor may see too (services.public uses it). Owner-only fields are added below."""
    return {
        "id": r["id"], "title": r["title"], "image": r["image"], "link": r["link"],
        "authors": r["authors"], "year": r["year"], "venue": r["venue"], "tags": list(r["tags"]),
        "status": r["status"], "rating": r["rating"], "summary": r["summary"],
        "createdAt": to_ms(r["created_at"]), "updatedAt": to_ms(r["updated_at"]),
    }


def _owner_only(r: Mapping) -> dict:
    return {"sample": r["is_sample"], "public": r["is_public"], "revision": r["revision"]}


def card_json(r: Mapping) -> dict:
    return {**_common(r), **_owner_only(r), "bodyText": r["body_text"],
            "sectionsFilled": mask_to_keys(r["sections_filled"])}


def full_json(r: Mapping) -> dict:
    return {**_common(r), **_owner_only(r), "content": r["content"]}


# ---------- field cleanup (normalizePaper) ----------
def norm_tags(t: Any) -> List[str]:
    arr = t if isinstance(t, list) else str(t or "").split(",")
    out: List[str] = []
    for x in arr:
        v = re.sub(r"\s+", "-", re.sub(r"^#+", "", str(x).strip().lower()))[:32]
        if v and v not in out:
            out.append(v)
    return out[:MAX_TAGS]


def _rating(v: Any) -> int:
    m = re.match(r"\s*[+-]?\d+", str(v if v is not None else ""))
    return min(5, max(0, int(m.group()) if m else 0))


def _year(v: Any) -> str:
    if not v:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()[:4]


def template_blocks() -> List[dict]:
    out: List[dict] = []
    for title in SECTION_TITLES:
        out += [{"type": "h2", "text": title}, {"type": "p", "text": ""}]
    return out


def legacy_content(r: Mapping) -> List[dict]:
    blocks = template_blocks()
    notes = str(r.get("notes") or "").strip()
    if notes:
        blocks += [{"type": "h2", "text": "Notes"}, {"type": "p", "text": html.escape(notes).replace("\n", "<br>")}]
    return blocks


def _title(v: Any) -> str:
    t = str(v or "").strip()[:300]
    if not t:
        raise invalid("title: a paper needs a title")
    return t


_SCALARS = {
    "title": _title,
    "image": safe_img,
    "link": safe_href,
    "authors": lambda v: str(v or "").strip()[:400],
    "year": _year,
    "venue": lambda v: str(v or "").strip()[:120],
    "tags": norm_tags,
    "status": lambda v: v if v in STATUS else "want",
    "rating": _rating,
    "summary": lambda v: str(v or "").strip(),
}


def _no_nul(v: Any) -> Any:
    """Postgres text and jsonb cannot hold NUL; pasted PDF text sometimes has it."""
    if isinstance(v, str):
        return v.replace("\x00", "")
    if isinstance(v, list):
        return [_no_nul(x) for x in v]
    if isinstance(v, dict):
        return {_no_nul(k): _no_nul(x) for k, x in v.items()}
    return v


def clean_fields(data: Mapping, strict: bool, max_content: int) -> dict:
    """Cleans the fields present in data into column values, adding derived columns for content."""
    data = _no_nul(dict(data))
    out: dict = {}
    for k, fn in _SCALARS.items():
        if k in data:
            out[k] = fn(data[k])
    if "content" in data:
        try:
            blocks = norm_blocks(data["content"], strict=strict)
        except ContentError as e:
            raise invalid(f"content: {e}")
        js = json.dumps(blocks, ensure_ascii=False, separators=(",", ":"))
        if len(js.encode()) > max_content:
            raise too_large()
        out["content"] = js
        out["body_text"], out["sections_filled"] = derive(blocks)
    return out


def patch_fields(data: Mapping, max_content: int) -> dict:
    """clean_fields plus the Public switch, which only a PATCH can set."""
    out = clean_fields({k: v for k, v in data.items() if k != "public"}, strict=True, max_content=max_content)
    if data.get("public") is not None:
        out["is_public"] = bool(data["public"])
    return out


def _full_row(data: Mapping, strict: bool, max_content: int) -> dict:
    """Every column for a new row, defaults filled in."""
    base = {k: data.get(k) for k in _SCALARS}
    base["content"] = data["content"] if isinstance(data.get("content"), list) else legacy_content(data)
    return clean_fields(base, strict, max_content)


def _check_id(pid: str) -> str:
    if not ID_RE.fullmatch(pid or ""):
        raise not_found()
    return pid


def parse_if_match(value: Optional[str]) -> int:
    if value is None or not value.strip():
        raise ServiceError(428, "revision_required", "Send If-Match with the revision you loaded.")
    v = value.strip()
    if v.startswith("W/"):
        v = v[2:]
    v = v.strip('"')
    if not v.isdigit():
        raise invalid("If-Match must be a revision number")
    return int(v)


# ---------- operations ----------
def list_cards(engine: Engine, user_id: str) -> List[dict]:
    with user_tx(engine, user_id) as conn:
        return [card_json(r) for r in repo.list_cards(conn, user_id)]


def get_paper(engine: Engine, user_id: str, pid: str) -> dict:
    _check_id(pid)
    with user_tx(engine, user_id) as conn:
        row = repo.get(conn, user_id, pid)
    if row is None:
        raise not_found()
    return full_json(row)


def create_paper(engine: Engine, user_id: str, data: Mapping, max_content: int) -> dict:
    pid = data.get("id") or str(uuid.uuid4())
    if not ID_RE.fullmatch(pid):
        raise invalid("id: use 1 to 40 letters, digits, - or _")
    row = _full_row(data, strict=True, max_content=max_content)
    now = from_ms(now_ms())
    row.update(id=pid, is_sample=bool(data.get("sample")), created_at=now, updated_at=now)
    with user_tx(engine, user_id) as conn:
        made = repo.insert(conn, user_id, row)
    if made is None:
        raise ServiceError(409, "exists", "A paper with this id already exists.")
    return full_json(made)


def update_paper(engine: Engine, user_id: str, pid: str, revision: int, patch: Mapping, max_content: int) -> dict:
    _check_id(pid)
    fields = patch_fields(patch, max_content)
    with user_tx(engine, user_id) as conn:
        row = repo.update_if_revision(conn, user_id, pid, revision, fields)
        if row is not None:
            return card_json(row)
        current = repo.get(conn, user_id, pid)
    if current is None:
        raise not_found()
    raise ServiceError(409, "conflict", "This paper changed in another tab or device.",
                       {"current": full_json(current)})


def delete_paper(engine: Engine, user_id: str, pid: str) -> None:
    _check_id(pid)
    with user_tx(engine, user_id) as conn:
        found = repo.soft_delete(conn, user_id, pid)
        repo.purge_deleted(conn, user_id, 30)
    if not found:
        raise not_found()


def restore_paper(engine: Engine, user_id: str, pid: str) -> dict:
    _check_id(pid)
    with user_tx(engine, user_id) as conn:
        row = repo.restore(conn, user_id, pid)
    if row is None:
        raise not_found()
    return card_json(row)


def list_trash(engine: Engine, user_id: str) -> List[dict]:
    with user_tx(engine, user_id) as conn:
        repo.purge_deleted(conn, user_id, 30)
        return [{**card_json(r), "deletedAt": to_ms(r["deleted_at"])} for r in repo.list_trash(conn, user_id)]


def publish_all(engine: Engine, user_id: str) -> dict:
    with user_tx(engine, user_id) as conn:
        return {"published": repo.publish_all(conn, user_id)}


def delete_forever(engine: Engine, user_id: str, pid: str, title: str) -> None:
    """Hard-deletes a paper in the Trash once the owner types its exact title (NFC, no trim, case-sensitive)."""
    _check_id(pid)
    with user_tx(engine, user_id) as conn:
        row = repo.get_any(conn, user_id, pid)
        if row is None:
            raise not_found()
        if row["deleted_at"] is None:
            raise ServiceError(409, "not_in_trash", "Move this paper to the Trash first.")
        if unicodedata.normalize("NFC", title) != unicodedata.normalize("NFC", row["title"]):
            raise ServiceError(400, "title_mismatch", "The title you typed does not match this paper's title.")
        repo.hard_delete(conn, user_id, pid)


def delete_many(engine: Engine, user_id: str, sample: bool, confirm: Optional[str]) -> dict:
    if not sample and confirm != "wipe":
        raise ServiceError(400, "confirm_required", "Send X-Confirm: wipe to delete every paper.")
    with user_tx(engine, user_id) as conn:
        n = repo.delete_samples(conn, user_id) if sample else repo.delete_all(conn, user_id)
    return {"deleted": n}


def export_papers(engine: Engine, user_id: str) -> Iterator[str]:
    """A JSON array, one paper per chunk, inside one transaction."""
    with user_tx(engine, user_id) as conn:
        yield "["
        sep = ""
        for row in repo.iter_full(conn, user_id):
            yield sep + json.dumps(full_json(row), ensure_ascii=False, separators=(",", ":"))
            sep = ","
        yield "]"


def import_papers(engine: Engine, user_id: str, body: Any, max_content: int) -> dict:
    if isinstance(body, dict) and isinstance(body.get("papers"), list):
        items = body["papers"]
    elif isinstance(body, list):
        items = body
    else:
        raise invalid("body: send a list of papers or {\"papers\": [...]}")
    counts = {"created": 0, "updated": 0, "skipped": 0}
    errors: List[dict] = []
    with user_tx(engine, user_id) as conn:
        for raw in items:
            if not isinstance(raw, dict) or not str(raw.get("title") or "").strip():
                counts["skipped"] += 1
                continue
            raw_id = str(raw.get("id") or "")
            try:
                pid = re.sub(r"[^A-Za-z0-9_-]", "", raw_id) or str(uuid.uuid4())
                if len(pid) > 40:
                    raise invalid("id is longer than 40 characters")
                row = _full_row(raw, strict=False, max_content=max_content)
                row.update(
                    id=pid, is_sample=bool(raw.get("sample")),
                    created_at=from_ms(_ms_or_now(raw.get("createdAt"))),
                    updated_at=from_ms(_ms_or_now(raw.get("updatedAt"))),
                )
                with conn.begin_nested():
                    counts[repo.upsert_import(conn, user_id, row)] += 1
            except ServiceError as e:
                errors.append({"id": raw_id, "reason": e.message})
            except DBAPIError:
                # The savepoint is rolled back; the other papers still go in. No database text to the client.
                errors.append({"id": raw_id, "reason": "the database refused this paper"})
    return {**counts, "errors": errors}
