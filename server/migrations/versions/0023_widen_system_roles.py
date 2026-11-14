"""放宽 system_roles.role 的取值：路线/地点审核员在生产库原本无法授予

0016 的 CHECK 只允许 'ad_reviewer'，但代码里 require_route_curator /
require_place_curator / require_content_reviewer / require_collaboration_reviewer
查的是别的角色名 —— 这些角色永远插不进去，对应管理接口永远 403。

Revision ID: 0023_widen_system_roles
Revises: 0022_directional_difficulty
"""
from alembic import op

revision = "0023_widen_system_roles"
down_revision = "0022_directional_difficulty"
branch_labels = None
depends_on = None

ROLES = ("ad_reviewer", "place_curator", "route_curator",
         "content_reviewer", "collaboration_reviewer")


def upgrade() -> None:
    op.execute("ALTER TABLE system_roles DROP CONSTRAINT IF EXISTS system_roles_role_check")
    op.execute("""ALTER TABLE system_roles ADD CONSTRAINT system_roles_role_check
        CHECK (role IN (%s))""" % ", ".join("'%s'" % r for r in ROLES))


def downgrade() -> None:
    raise RuntimeError("forward-only: 回退前先确认没有非 ad_reviewer 的角色")
