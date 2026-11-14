"""点位众包确认支持「建议名称」

已发布但无名的点位也需要能收用户建议，所以给 route_point_confirmations 加 suggested_name。

Revision ID: 0024_point_name_suggestions
Revises: 0023_widen_system_roles
"""
from alembic import op

revision = "0024_point_name_suggestions"
down_revision = "0023_widen_system_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE route_point_confirmations ADD COLUMN IF NOT EXISTS suggested_name TEXT")


def downgrade() -> None:
    raise RuntimeError("forward-only")
