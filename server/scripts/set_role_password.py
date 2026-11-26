"""Sets a database role's password from an environment variable.

    python -m scripts.set_role_password ROLE ENV_VAR

Connects with MIGRATE_DATABASE_URL (the owner role). The password is read from ENV_VAR and
sent as a quoted SQL literal; it is never printed or logged. Passwords are kept out of the
migration files on purpose, so this runs once per environment.
"""
from __future__ import annotations

import os
import sys
from typing import Mapping, Optional, Sequence

import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url

MIN_LENGTH = 20


def _conninfo(url: str) -> str:
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


def set_password(url: str, role: str, password: str) -> None:
    with psycopg.connect(_conninfo(url), autocommit=True) as conn:
        conn.execute(sql.SQL("ALTER ROLE {} WITH PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))


def main(argv: Sequence[str], env: Optional[Mapping[str, str]] = None) -> int:
    env = os.environ if env is None else env
    if len(argv) != 2:
        print("usage: python -m scripts.set_role_password ROLE ENV_VAR", file=sys.stderr)
        return 2
    role, var = argv
    password = env.get(var, "")
    if not password:
        print(f"{var} is empty; put the password in your env file first", file=sys.stderr)
        return 2
    if len(password) < MIN_LENGTH:
        print(f"{var} is too short; use at least {MIN_LENGTH} characters", file=sys.stderr)
        return 2
    url = env.get("MIGRATE_DATABASE_URL", "")
    if not url:
        print("MIGRATE_DATABASE_URL is empty", file=sys.stderr)
        return 2
    try:
        set_password(url, role, password)
    except psycopg.Error as e:
        # The server's message names the role, never the password.
        print(f"could not set the password for {role}: {type(e).__name__}", file=sys.stderr)
        return 1
    print(f"password set for {role}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
