"""journey schema: users, papers, app and backup roles, row level security

Revision ID: 0001
Revises:
Create Date: 2026-11-23

Role passwords are never set here. Set them once by hand
(server/scripts/set_role_password.py).
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

UPGRADE = r"""
-- Roles: created only if missing (roles are shared by every database in the cluster).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'journey_app') THEN
    CREATE ROLE journey_app LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'journey_backup') THEN
    CREATE ROLE journey_backup LOGIN NOINHERIT;
  END IF;
END $$;

-- A dedicated schema, not public: Supabase's Data API does not expose it.
CREATE SCHEMA journey;
REVOKE ALL ON SCHEMA journey FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA journey FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA journey FROM authenticated';
  END IF;
END $$;

CREATE TABLE journey.users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  display_name  text,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journey.papers (
  user_id         uuid NOT NULL REFERENCES journey.users(id) ON DELETE CASCADE,
  id              text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  title           text NOT NULL,
  link            text NOT NULL DEFAULT '',
  authors         text NOT NULL DEFAULT '',
  year            text NOT NULL DEFAULT '',
  venue           text NOT NULL DEFAULT '',
  tags            text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'want' CHECK (status IN ('want', 'reading', 'done')),
  rating          smallint NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  summary         text NOT NULL DEFAULT '',
  image           text NOT NULL DEFAULT '',
  content         jsonb NOT NULL DEFAULT '[]',
  body_text       text NOT NULL DEFAULT '',
  sections_filled smallint NOT NULL DEFAULT 0,
  is_sample       boolean NOT NULL DEFAULT false,
  revision        int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX papers_user_idx ON journey.papers (user_id, updated_at DESC) WHERE deleted_at IS NULL;

-- Least privilege: the API role reads and writes rows, the backup role only reads.
GRANT USAGE ON SCHEMA journey TO journey_app, journey_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON journey.users, journey.papers TO journey_app;
GRANT SELECT ON journey.users, journey.papers TO journey_backup;

-- Row Level Security. FORCE makes it apply to the table owner too.
ALTER TABLE journey.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.users FORCE ROW LEVEL SECURITY;
ALTER TABLE journey.papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.papers FORCE ROW LEVEL SECURITY;

CREATE POLICY own_rows ON journey.users FOR ALL
  USING (id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.user_id', true)::uuid);
CREATE POLICY own_rows ON journey.papers FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- The nightly pg_dump (--enable-row-security) reads every row through these.
CREATE POLICY backup_read ON journey.users FOR SELECT TO journey_backup USING (true);
CREATE POLICY backup_read ON journey.papers FOR SELECT TO journey_backup USING (true);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    # Roles are left in place: other databases in the cluster may use them.
    op.execute("DROP SCHEMA journey CASCADE")
