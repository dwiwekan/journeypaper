"""close public.alembic_version to Supabase's Data API roles

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-26

Alembic keeps its version table in public. On Supabase, default privileges give anon and
authenticated access to new tables there, so the publishable key could read or change it.
Row level security with no policy blocks those roles; the owner (who migrates) is not affected.
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

UPGRADE = r"""
REVOKE ALL ON public.alembic_version FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.alembic_version FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.alembic_version FROM authenticated';
  END IF;
END $$;
ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute("ALTER TABLE public.alembic_version DISABLE ROW LEVEL SECURITY")
