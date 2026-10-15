"""限流事件表：rate_limit_events

改了什么：新增一张限流事件表。写接口（留言/情报、打卡、举报）被限流拦下时，
每次命中写一行：作用域、命中的桶（哈希）、身份、IP 哈希、路径、时间。

为什么：验收要求"限流事件可审计"。原来只 auth_rate_limits 里有个计数器，
看不到"谁在什么时候被哪一桶拦下几次"，也就没法判断误伤还是恶意刷。
这里只存 IP 的 SHA-256，不存明文 IP；明文 IP 是否保留、保留多久，留给
隐私政策与日志保留期那两项决定，本表默认按 30 天清理（清理任务属于监控/告警一项）。

验收怎么跑：`bash server/tests/rate_limit_drill.sh`，最后会打印本表里的行。
"""
from __future__ import annotations

from alembic import op

revision = "0003_rate_limit_events"
down_revision = "0002_content_reports"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id         BIGSERIAL PRIMARY KEY,
  scope      TEXT NOT NULL,          -- comment / visit / report
  bucket_key TEXT NOT NULL,          -- 命中的桶（身份或 IP 的哈希桶）
  identity   TEXT,                   -- u:<user_id> / g:<guest_id>，无身份时为空
  ip_hash    TEXT NOT NULL,          -- 只存 SHA-256，不存明文 IP
  path       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_recent
  ON rate_limit_events (scope, created_at DESC);
"""

DOWNGRADE_SQL = "DROP TABLE IF EXISTS rate_limit_events;"


def _exec(conn, sql_text: str) -> None:
    raw = conn.connection.driver_connection      # 同 0001/0002：多语句要绕开参数绑定
    with raw.cursor() as cur:
        cur.execute(sql_text)


def upgrade() -> None:
    _exec(op.get_bind(), UPGRADE_SQL)


def downgrade() -> None:
    _exec(op.get_bind(), DOWNGRADE_SQL)
