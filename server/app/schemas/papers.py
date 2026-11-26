"""Paper JSON as the front-end sends and reads it (camelCase, times in ms).

Input models only check the shape; services/papers.py cleans every value the way
normalizePaper in web/js/data/paper.js does.
"""
from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class PaperIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    title: str
    image: Any = ""
    link: Any = ""
    authors: Any = ""
    year: Any = ""
    venue: Any = ""
    tags: Any = None
    status: Any = "want"
    rating: Any = 0
    summary: Any = ""
    content: Optional[List[Any]] = None
    sample: bool = False


class PaperPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = None
    image: Any = None
    link: Any = None
    authors: Any = None
    year: Any = None
    venue: Any = None
    tags: Any = None
    status: Any = None
    rating: Any = None
    summary: Any = None
    content: Optional[List[Any]] = None
    public: Optional[bool] = None


class ForeverIn(BaseModel):
    """Delete forever: the paper's title, typed by the owner."""
    title: str = Field(max_length=300)


class _Common(BaseModel):
    id: str
    title: str
    image: str
    link: str
    authors: str
    year: str
    venue: str
    tags: List[str]
    status: str
    rating: int
    summary: str
    sample: bool
    public: bool
    createdAt: int
    updatedAt: int
    revision: int


class PaperOut(_Common):
    content: List[dict]


class CardOut(_Common):
    bodyText: str
    sectionsFilled: List[str]


class TrashOut(CardOut):
    deletedAt: int
