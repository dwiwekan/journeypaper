"""Server copies of the front-end content rules.

Mirrors web/js/editor/sanitize.js (cleanInline, plain, safeHref, safeImg),
web/js/editor/blocks.js (normBlocks, blockPlain) and the section rules in
web/js/data/paper.js (sectionKey, derived). Keep them in step.
"""
import html as _html
import random
import re
import string
import unicodedata
from typing import Any, List, Optional, Tuple
from urllib.parse import urlsplit

import nh3

TEXT = ["p", "h2", "h3", "ul", "ol", "quote", "callout"]
ALL = TEXT + ["code", "equation", "image", "divider"]
MAX_BLOCKS = 600
MAX_CODE = 20000
MAX_TEX = 4000
MAX_CAPTION = 300
WIDTHS = ("s", "m", "l")

SECTION_BITS = {"intro": 1, "related": 2, "method": 4, "results": 8, "concl": 16}
_ALIASES = {
    "intro": ["introduction", "pendahuluan"],
    "related": ["related work", "related works", "tinjauan pustaka", "literature review"],
    "method": ["method", "methods", "methodology", "metode", "approach"],
    "results": ["experiment results", "experiments", "experiment", "results", "hasil eksperimen", "hasil", "evaluation"],
    "concl": ["conclusion", "conclusions", "kesimpulan"],
}
_ALIAS_TO_KEY = {a: k for k, names in _ALIASES.items() for a in names}

_DATA_IMG = re.compile(r"^data:image/(png|jpe?g|webp|gif|avif);base64,", re.I)
_TAG = re.compile(r"<[^>]*>")
_A_NO_HREF = re.compile(r"<a\b(?![^>]*\shref=)[^>]*>(.*?)</a>", re.S)
_TRAILING_BR = re.compile(r"(<br>)+$")
_ID_CHARS = re.compile(r"[^A-Za-z0-9_-]")


class ContentError(ValueError):
    """A paper's content breaks the rules in strict mode."""


def safe_href(u: Any) -> str:
    s = str(u or "").strip()
    try:
        parts = urlsplit(s)
    except ValueError:
        return ""
    return s if parts.scheme.lower() in ("http", "https") and parts.netloc else ""


def safe_img(u: Any) -> str:
    s = str(u or "").strip()
    return s if _DATA_IMG.match(s) else safe_href(s)


def _attr_filter(tag: str, attr: str, value: str) -> Optional[str]:
    if tag == "a" and attr == "href":
        return safe_href(value) or None
    return value


def plain(html: Any) -> str:
    return _html.unescape(_TAG.sub("", str(html or ""))).replace(" ", " ")


def sanitize_inline(html: Any) -> str:
    out = nh3.clean(
        str(html or ""),
        tags={"b", "strong", "i", "em", "code", "a", "br"},
        clean_content_tags={"script", "style", "iframe", "object", "embed", "template", "svg", "math"},
        attributes={"a": {"href", "title"}},
        attribute_filter=_attr_filter,
        url_schemes={"http", "https"},
        link_rel="noopener noreferrer",
        set_tag_attribute_values={"a": {"target": "_blank"}},
    )
    out = _A_NO_HREF.sub(r"\1", out)
    for old, new in (("strong", "b"), ("em", "i")):
        out = out.replace(f"<{old}>", f"<{new}>").replace(f"</{old}>", f"</{new}>")
    if not plain(out).strip():
        return ""
    return _TRAILING_BR.sub("", out)


def _block_id() -> str:
    return "b" + "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


def _clean_id(s: Any) -> str:
    return _ID_CHARS.sub("", str(s or ""))[:40] or _block_id()


def norm_blocks(raw: Any, strict: bool) -> List[dict]:
    """Validate and clean a block list. strict=True rejects unknown types."""
    if not isinstance(raw, list):
        if strict:
            raise ContentError("content must be a list of blocks")
        return []
    out: List[dict] = []
    seen = set()
    for r in raw[:MAX_BLOCKS]:
        if not isinstance(r, dict):
            continue
        t = r.get("type")
        if t not in ALL:
            if strict:
                raise ContentError(f"unknown block type: {t}")
            t = "p"
        bid = _clean_id(r.get("id"))
        while bid in seen:
            bid = _block_id()
        seen.add(bid)
        b: dict = {"id": bid, "type": t}
        if t in TEXT:
            b["text"] = sanitize_inline(r.get("text"))
        elif t == "code":
            b["text"] = str(r.get("text") or "")[:MAX_CODE]
        elif t == "equation":
            b["tex"] = str(r.get("tex") or "")[:MAX_TEX]
        elif t == "image":
            b["src"] = safe_img(r.get("src"))
            b["caption"] = str(r.get("caption") or "")[:MAX_CAPTION]
            b["w"] = r.get("w") if r.get("w") in WIDTHS else "l"
        out.append(b)
    return out


def norm(s: Any) -> str:
    d = unicodedata.normalize("NFD", str(s if s is not None else ""))
    return re.sub("[̀-ͯ]", "", d).lower()


def section_key(text: Any) -> Optional[str]:
    k = re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", norm(text))).strip()
    return _ALIAS_TO_KEY.get(k)


def _block_plain(b: dict) -> str:
    t = b.get("type")
    if t in TEXT:
        return plain(b.get("text"))
    if t == "code":
        return b.get("text") or ""
    if t == "equation":
        return b.get("tex") or ""
    if t == "image":
        return b.get("caption") or ""
    return ""


def _has_content(b: dict) -> bool:
    if b.get("type") in ("divider", "h2", "h3"):
        return False
    return bool(_block_plain(b).strip()) or (b.get("type") == "image" and bool(b.get("src")))


def derive(blocks: List[dict]) -> Tuple[str, int]:
    """(body_text, sections_filled mask), as derived() in web/js/data/paper.js."""
    filled = set()
    parts: List[str] = []
    cur: Optional[str] = None
    for b in blocks:
        if b.get("type") == "h2":
            cur = section_key(plain(b.get("text")))
            if not cur:
                parts.append(plain(b.get("text")))
            continue
        if cur and _has_content(b):
            filled.add(cur)
        t = _block_plain(b)
        if t:
            parts.append(t)
    mask = sum(SECTION_BITS[k] for k in filled)
    return "\n".join(parts), mask


def mask_to_keys(mask: int) -> List[str]:
    return [k for k, bit in SECTION_BITS.items() if mask & bit]
