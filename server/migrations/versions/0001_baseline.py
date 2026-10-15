"""基线：把 001–023 的既有 SQL 收进 alembic（逐文件哨兵，缺哪补哪）

改了什么：2026-10-14 以前，表结构靠手工按文件名顺序执行 `server/db/001–023`，
没有版本台账，答不出"这个环境跑到哪一版"。本修订把这段历史收成一个 alembic 版本：

- 全新空库：按文件名顺序执行 001–023。
- 已有库：先看每个文件的哨兵对象在不在，在的跳过、不在的执行。因此停在 018 的半升级库
  也能只补 019–023，不会重复建表。
- 跑完再核一遍全部哨兵；有对象仍然不存在就抛错，整版回滚、`alembic_version` 不前进、
  退出码非 0——不会出现"迁移失败却记成功"。

为什么这么写：`db/001` 里是裸 `CREATE TABLE`（没有 IF NOT EXISTS），无法重复执行；
靠哨兵判断而不是靠重放，才能既支持空库又支持已有库。

验收怎么跑：见 docs/DEPLOY.md「迁移台账与升级」，或 `server/migrations/README.md`。
"""
from __future__ import annotations

import pathlib

from alembic import op
from sqlalchemy import text

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

DB_DIR = pathlib.Path(__file__).resolve().parents[2] / "db"

# 每个历史迁移一个哨兵：能证明它已经生效的最小事实。
# ("文件名", "table"|"column"|"nullable", "表" 或 "表.列")
SENTINELS: list[tuple[str, str, str]] = [
    ("001_schema.sql", "table", "routes"),
    ("002_wants.sql", "table", "wants"),
    ("003_points_name_nullable.sql", "nullable", "points.name"),
    ("004_user_tracks.sql", "table", "user_tracks"),
    ("005_race_routes.sql", "column", "routes.kind"),
    ("006_route_source.sql", "column", "routes.source"),
    ("007_point_regions.sql", "column", "points.city"),
    ("008_route_checkpoints.sql", "table", "route_checkpoints"),
    ("009_notification_seen.sql", "column", "users.notif_seen_at"),
    ("010_summit_ads.sql", "table", "summit_ads"),
    ("011_ad_promoted.sql", "column", "summit_ads.promoted"),
    ("012_guest_mode.sql", "table", "guests"),
    ("013_stable_trail_entities.sql", "table", "boards"),
    ("014_arrival_drafts.sql", "table", "account_arrival_drafts"),
    ("015_user_password_auth.sql", "column", "users.password_hash"),
    ("016_system_roles.sql", "table", "system_roles"),
    ("017_point_mountain_boards.sql", "column", "points.mountain_id"),
    ("018_mountain_link_review.sql", "table", "mountain_identity_links"),
    ("019_arrival_publish_receipts.sql", "table", "arrival_publish_receipts"),
    ("020_ad_draft_versions.sql", "column", "summit_ads.duration_days"),
    ("021_board_collaboration.sql", "table", "board_collaboration_applications"),
    ("022_maintenance_audit.sql", "table", "maintenance_audit_logs"),
    ("023_comment_appeals.sql", "table", "comment_appeals"),
]

# 台账表：alembic_version 只记"当前是哪一版"，这张表记"哪一版什么时候升的"。
MIGRATION_LOG_DDL = """
    CREATE TABLE IF NOT EXISTS migration_log (
      id         BIGSERIAL PRIMARY KEY,
      version    TEXT NOT NULL,
      action     TEXT NOT NULL DEFAULT 'upgrade',   -- upgrade / stamp
      comment    TEXT,
      applied_by TEXT NOT NULL DEFAULT current_user,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_migration_log_at ON migration_log (applied_at DESC);
"""


def _probe_sql(kind: str, target: str) -> str:
    if kind == "table":
        return (f"SELECT to_regclass('public.{target}') IS NOT NULL "
                f"AND EXISTS (SELECT 1 FROM information_schema.columns "
                f"WHERE table_schema = 'public' AND table_name = '{target}')")
    table, column = target.split(".")
    extra = " AND is_nullable = 'YES'" if kind == "nullable" else ""
    return ("SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            f"WHERE table_schema = 'public' AND table_name = '{table}' "
            f"AND column_name = '{column}'{extra})")


def _applied(conn, kind: str, target: str) -> bool:
    return bool(conn.execute(text(_probe_sql(kind, target))).scalar())


def _exec_script(conn, sql_text: str) -> None:
    """原样执行整段 SQL 脚本（含多语句）。

    不走 SQLAlchemy 的 exec_driver_sql：即使不传参数，它也会带一个空参数集调用
    driver，psycopg3 于是按 %s 占位符解析，脚本里 `LIKE 'legacy-route-segment:%'`
    这种字面百分号会直接报 "only '%s', '%b', '%t' are allowed as placeholders"。
    psycopg3 只在**完全省略参数**时走简单协议、允许一条命令多条语句，所以这里
    落到 driver 连接上直接 cursor.execute(sql)。
    """
    raw = conn.connection.driver_connection
    with raw.cursor() as cur:
        cur.execute(sql_text)


def upgrade() -> None:
    conn = op.get_bind()

    executed: list[str] = []
    skipped: list[str] = []
    for filename, kind, target in SENTINELS:
        if _applied(conn, kind, target):
            skipped.append(filename)
            continue
        path = DB_DIR / filename
        if not path.exists():
            raise RuntimeError(f"缺少迁移文件 {filename}，应在 {DB_DIR}")
        print(f"[migrate] 执行 {filename}")
        _exec_script(conn, path.read_text(encoding="utf-8"))
        executed.append(filename)

    still_missing = [f for f, kind, target in SENTINELS if not _applied(conn, kind, target)]
    if still_missing:
        raise RuntimeError(
            "以下迁移执行后哨兵仍不存在，说明脚本没真正生效或库被手工改过："
            + "、".join(still_missing))

    _exec_script(conn, MIGRATION_LOG_DDL)
    print(f"[migrate] 基线完成：新执行 {len(executed)} 个文件，跳过 {len(skipped)} 个；"
          f"哨兵全部通过")


def downgrade() -> None:
    raise RuntimeError(
        "基线不支持 downgrade。回退请按 docs/DEPLOY.md「回滚」用备份恢复到发布前的库，"
        "不要用降级脚本删表。")
