"""Runs migrations as the owner role. The URL comes from the environment only."""
from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from app.db import sqlalchemy_url

config = context.config
if config.config_file_name and not config.attributes.get("url"):
    fileConfig(config.config_file_name)


def _url() -> str:
    url = config.attributes.get("url") or context.get_x_argument(as_dictionary=True).get("url")
    url = url or os.environ.get("MIGRATE_DATABASE_URL")
    if not url:
        raise SystemExit("Set MIGRATE_DATABASE_URL (see .env.example).")
    return sqlalchemy_url(url)


def run() -> None:
    # Session-level connection: run migrations through a direct or session-pooler URL.
    engine = create_engine(_url(), connect_args={"prepare_threshold": None})
    with engine.connect() as conn:
        context.configure(connection=conn, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline mode is not supported; run against a database.")
run()
