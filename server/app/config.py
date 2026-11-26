"""Settings from environment variables only. No secrets in code."""
from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from typing_extensions import Annotated


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str
    supabase_url: str = "https://xxgdylyvbbohjpibwucv.supabase.co"
    jwt_audience: str = "authenticated"
    admin_emails: Annotated[List[str], NoDecode] = []
    cors_origins: Annotated[List[str], NoDecode] = ["http://localhost:8000"]
    max_body_bytes: int = 8_388_608
    max_content_bytes: int = 8_388_608
    rate_per_minute: int = 120
    public_rate_per_minute: int = 60
    # Proxies in front of the app that append to X-Forwarded-For (Cloud Run: 1).
    xff_hops: int = 1

    @field_validator("admin_emails", "cors_origins", mode="before")
    @classmethod
    def _split_csv(cls, v):
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

    @property
    def jwt_issuer(self) -> str:
        return self.supabase_url.rstrip("/") + "/auth/v1"

    @property
    def jwks_url(self) -> str:
        return self.jwt_issuer + "/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
