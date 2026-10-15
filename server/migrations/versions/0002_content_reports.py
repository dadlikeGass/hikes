"""举报：content_reports 表 + 把 report.review 加进审计动作白名单

改了什么：
1. 新增 `content_reports`：游客或账号都能对一条留言（岔路情报也是留言）提交**非公开**举报，
   带原因、可选说明、提交者身份；同一身份对同一对象只保留一条待处理举报（部分唯一索引）。
2. `maintenance_audit_logs.action` 白名单增加 `report.review`。

为什么：上线合规最小集要求"举报入口 + 非公开落库 + 审核队列 + 处置留痕"。
举报不是公开内容，普通用户只能看自己的举报；处置由 `content_reviewer` 角色执行，
审核人不能审自己提交的举报，通过并选择隐藏时复用 `comment.hide` 审计，
因此原作者仍能走 023 的申诉通道。

注意：`reporter_user_id` / `reporter_guest_id` 是 `ON DELETE SET NULL`，而且**不**加
"必须至少有一个身份"的约束——否则账号注销（P0 的账号数据权利）会被举报记录挡住删除。
可追溯性由 `reporter_key`（`u:<id>` / `g:<id>`）保证：账号删了，举报里仍留着它是谁提交的。

验收怎么跑：见 docs/API.md「9. 举报与处置」。
"""
from __future__ import annotations

from alembic import op

revision = "0002_content_reports"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

AUDIT_ACTIONS_WITH_REPORT = (
    "'point.update', 'comment.hide', 'comment.appeal_review', 'comment.restore', "
    "'collaboration.review', 'ad.review', 'ad.promote', 'report.review'")
AUDIT_ACTIONS_BEFORE = (
    "'point.update', 'comment.hide', 'comment.appeal_review', 'comment.restore', "
    "'collaboration.review', 'ad.review', 'ad.promote'")

UPGRADE_SQL = f"""
CREATE TABLE IF NOT EXISTS content_reports (
  id               BIGSERIAL PRIMARY KEY,
  -- 目前只有留言一种举报对象（岔路情报就是岔路点位上的留言）。
  -- 广告举报随广告一起冻结；点位纠错属于岔路页的纠错入口，另做。
  target_type      TEXT NOT NULL CHECK (target_type IN ('comment')),
  target_id        BIGINT NOT NULL,
  reason           TEXT NOT NULL CHECK (reason IN
                     ('spam', 'abuse', 'false_info', 'privacy', 'illegal', 'other')),
  detail           TEXT CHECK (detail IS NULL OR char_length(detail) BETWEEN 2 AND 200),
  reporter_user_id  BIGINT REFERENCES users(id)  ON DELETE SET NULL,
  reporter_guest_id BIGINT REFERENCES guests(id) ON DELETE SET NULL,
  -- 身份去重键：u:<user_id> / g:<guest_id>，同一身份对同一对象只留一条待处理举报
  -- 身份追踪键：u:<user_id> / g:<guest_id>。账号注销后 user_id 置空，这条键仍留痕。
  reporter_key     TEXT NOT NULL CHECK (char_length(reporter_key) BETWEEN 3 AND 40),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'rejected')),
  handled_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  handled_at       TIMESTAMPTZ,
  handle_reason    TEXT,
  action_taken     TEXT CHECK (action_taken IS NULL
                     OR action_taken IN ('comment.hide', 'none')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 处置过的举报必须写清由谁在何时处理
  CHECK (status = 'pending' OR (handled_by IS NOT NULL AND handled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_reports_queue ON content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON content_reports (target_type, target_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_open_reporter
  ON content_reports (target_type, target_id, reporter_key) WHERE status = 'pending';

ALTER TABLE maintenance_audit_logs DROP CONSTRAINT IF EXISTS maintenance_audit_logs_action_check;
ALTER TABLE maintenance_audit_logs ADD CONSTRAINT maintenance_audit_logs_action_check
  CHECK (action IN ({AUDIT_ACTIONS_WITH_REPORT}));
"""

DOWNGRADE_SQL = f"""
ALTER TABLE maintenance_audit_logs DROP CONSTRAINT IF EXISTS maintenance_audit_logs_action_check;
ALTER TABLE maintenance_audit_logs ADD CONSTRAINT maintenance_audit_logs_action_check
  CHECK (action IN ({AUDIT_ACTIONS_BEFORE}));
DROP TABLE IF EXISTS content_reports;
"""


def _exec(conn, sql_text: str) -> None:
    """原样执行多语句脚本。同 0001：psycopg3 只在省略参数时走简单协议。"""
    raw = conn.connection.driver_connection
    with raw.cursor() as cur:
        cur.execute(sql_text)


def upgrade() -> None:
    _exec(op.get_bind(), UPGRADE_SQL)


def downgrade() -> None:
    # 这一版可以真降级（没有历史数据的既有环境依赖它），但正式回退仍按 DEPLOY.md 用备份恢复。
    _exec(op.get_bind(), DOWNGRADE_SQL)
