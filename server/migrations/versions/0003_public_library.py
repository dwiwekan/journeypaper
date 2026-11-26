"""public library: papers.is_public, the journey_public role and its read policy

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-26

Public requests run as journey_public (SET LOCAL ROLE from journey_app). That role reads only
the columns granted below, and only rows that are public, live and not samples. It never writes. own_rows becomes journey_app's policy only.
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

PUBLIC_COLUMNS = (
    "user_id, id, title, link, authors, year, venue, tags, status, rating, summary, image, "
    "content, body_text, sections_filled, created_at, updated_at"
)

UPGRADE = rf"""
ALTER TABLE journey.papers ADD COLUMN is_public boolean NOT NULL DEFAULT false;
CREATE INDEX papers_public_idx ON journey.papers (updated_at DESC)
  WHERE is_public AND deleted_at IS NULL AND NOT is_sample;

-- Created only if missing (roles are shared by every database in the cluster). NOLOGIN: it is
-- only ever reached through SET ROLE from journey_app, so it has no password.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'journey_public') THEN
    CREATE ROLE journey_public NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT journey_public TO journey_app;

GRANT USAGE ON SCHEMA journey TO journey_public;
GRANT SELECT ({PUBLIC_COLUMNS}) ON journey.papers TO journey_public;

CREATE POLICY public_read ON journey.papers FOR SELECT TO journey_public
  USING (is_public AND deleted_at IS NULL AND NOT is_sample);

-- own_rows (0001) applied to every role, so it was OR-ed into journey_public's reads too, and
-- on a pooled session that once served a member app.user_id reads '' (not NULL), which does
-- not cast to uuid. It is the app's policy only, and an empty setting now means "no user".
ALTER POLICY own_rows ON journey.users TO journey_app
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);
ALTER POLICY own_rows ON journey.papers TO journey_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
"""

DOWNGRADE = rf"""
ALTER POLICY own_rows ON journey.users TO public
  USING (id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.user_id', true)::uuid);
ALTER POLICY own_rows ON journey.papers TO public
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
DROP POLICY IF EXISTS public_read ON journey.papers;
REVOKE SELECT ({PUBLIC_COLUMNS}) ON journey.papers FROM journey_public;
REVOKE USAGE ON SCHEMA journey FROM journey_public;
REVOKE journey_public FROM journey_app;
DROP INDEX IF EXISTS journey.papers_public_idx;
ALTER TABLE journey.papers DROP COLUMN IF EXISTS is_public;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    # The role is left in place, as 0001 leaves its roles: other databases may use it.
    op.execute(DOWNGRADE)
