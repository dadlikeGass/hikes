"""本地山头提名与点赞

Revision ID: 0021_peak_nominations
Revises: 0020_heat_order_indexes
Create Date: 2026-10-25
"""
from alembic import op

revision = "0021_peak_nominations"
down_revision = "0020_heat_order_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS peak_nominations (
          id bigserial PRIMARY KEY,
          name text NOT NULL,
          province text NOT NULL DEFAULT '',
          city text,
          status text NOT NULL DEFAULT 'active',
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (name, province)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS peak_nomination_votes (
          id bigserial PRIMARY KEY,
          nomination_id bigint NOT NULL REFERENCES peak_nominations(id) ON DELETE CASCADE,
          identity text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (nomination_id, identity)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS peak_nomination_votes")
    op.execute("DROP TABLE IF EXISTS peak_nominations")
