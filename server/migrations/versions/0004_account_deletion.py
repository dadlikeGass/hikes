"""账号注销：users.deleted_at

改了什么：users 表加一列 `deleted_at`，标记"这个账号已注销"。

为什么：注销不能靠 DELETE users 那一行——
`maintenance_audit_logs.actor_id` 和 `mountain_identity_links.reviewed_by` 是
ON DELETE RESTRICT（审核痕迹必须留住、且要能追到是谁审批的），
而 `comments.user_id` 是 CASCADE（物理删账号会把他的公开留言一起带走，
后来者就看不到那段路况了）。所以注销做成"删个人数据 + 把账号行匿名化"：

- 删掉：轨迹、到访、想去、私人纪念与草稿、发布回执、赞踩、自己作为作者的申诉、
  自己的协作申请、认领记录、系统角色；并清空他维护的点位的 maintainer_id。
- 保留正文但已去标识：公开留言、举报记录、审计行、审核记录——它们仍指向这行用户，
  但 username/nickname/email/avatar/password_hash/wx_openid 全部置空，
  页面显示为"山友"，且因为 password_hash 为空，任何登录方式都进不来。

验收怎么跑：`bash server/tests/account_deletion_drill.sh`。
"""
from __future__ import annotations

from alembic import op

revision = "0004_account_deletion"
down_revision = "0003_rate_limit_events"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
COMMENT ON COLUMN users.deleted_at IS
  '注销时间；非空表示账号已匿名化，username/nickname/email/password_hash 均为空，不能再登录';
"""

DOWNGRADE_SQL = "ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;"


def _exec(conn, sql_text: str) -> None:
    raw = conn.connection.driver_connection      # 同前：多语句要绕开参数绑定
    with raw.cursor() as cur:
        cur.execute(sql_text)


def upgrade() -> None:
    _exec(op.get_bind(), UPGRADE_SQL)


def downgrade() -> None:
    _exec(op.get_bind(), DOWNGRADE_SQL)
