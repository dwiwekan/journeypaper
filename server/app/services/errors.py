"""Errors services raise. They carry the HTTP status and error code but do not import FastAPI."""
from __future__ import annotations

from typing import Optional


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: Optional[dict] = None):
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra or {}


def not_found() -> ServiceError:
    return ServiceError(404, "not_found", "Paper not found.")


def invalid(message: str) -> ServiceError:
    return ServiceError(422, "invalid", message)


def too_large(message: str = "This paper is too large to save.") -> ServiceError:
    return ServiceError(413, "too_large", message)
