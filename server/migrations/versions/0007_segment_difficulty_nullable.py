"""分段难度可为空 + 记录段内最大连续下降。

改了什么：
  1. `route_segments.level` 允许 NULL。下降段过去被塞了一个 'easy' 占位值，
     只是一种兼容写法；真正的语义是"这段不适用登顶难度"。占位值会被任何只认
     level 的消费者（列表、色带、第三方接口）读成"简单"，必须去掉。
  2. `route_segments.max_drop_m` 记录段内最大连续下降（米）。切点只取山顶，
     没有峰的长下坡会被并进相邻段，这个值让它在界面上仍然看得见。
  3. `routes.hardest_level` 允许 NULL：整条线路没有可定级的爬升段时，
     过去被写成 'mid' 顶上，同样是把"不知道"说成了结论。
  4. 按新规则重算历史数据：只用**净爬升**段定级，且坡度 > 3% 或净爬升 ≥ 200 m
     二者取一（长缓坡也算爬升）。与 pipeline/build.py（算法版本 3）、
     server/app/main.py 的 SQL 三处一致；`confirmed = true` 的人工结论不动。

失败会怎样：Postgres 上每个修订自带事务，本文件任一条抛错即整版回滚，
`alembic_version` 不前进、退出码非 0，按 docs/DEPLOY.md 用备份恢复即可。

验收：
  · `SELECT count(*) FROM route_segments WHERE level IS NULL` 应等于
    下降段 + 平缓段的数量，且这些行的 difficulty_applicable 全为 false。
  · `SELECT count(*) FROM routes WHERE hardest_level IS NULL` 应等于
    "整条没有可定级爬升"的路线数（本地为 11 条：8 条区域路线 + 3 条赛事）。
  · 抽查一条全下降线路（如香植线）：下降段 level IS NULL、kind='desc'。
"""
from alembic import op

revision = "0007_segment_difficulty_nullable"
down_revision = "0006_comment_replies"
branch_labels = None
depends_on = None

# 与 pipeline/build.py:segment_rating 完全同一套规则
RATED = "rise > 0 AND (pct > 3 OR rise >= 200)"
NEW_LEVEL = ("CASE WHEN pct > 25 OR rise > 500 THEN 'hard' "
             "WHEN pct > 15 OR rise > 200 THEN 'mid' ELSE 'easy' END")


def upgrade() -> None:
    op.execute("ALTER TABLE route_segments ALTER COLUMN level DROP NOT NULL")
    op.execute("ALTER TABLE route_segments DROP CONSTRAINT IF EXISTS route_segments_level_check")
    op.execute("ALTER TABLE route_segments ADD CONSTRAINT route_segments_level_check "
               "CHECK (level IS NULL OR level IN ('easy','mid','hard','hidden'))")
    op.execute("ALTER TABLE route_segments ADD COLUMN IF NOT EXISTS max_drop_m INT NOT NULL DEFAULT 0")

    op.execute(f"UPDATE route_segments SET difficulty_applicable = ({RATED}), "
               f"level = CASE WHEN confirmed THEN level "
               f"WHEN {RATED} THEN {NEW_LEVEL} ELSE NULL END "
               f"WHERE source = 'auto'")

    op.execute("ALTER TABLE routes ALTER COLUMN hardest_level DROP NOT NULL")
    op.execute("ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_hardest_level_check")
    op.execute("ALTER TABLE routes ADD CONSTRAINT routes_hardest_level_check "
               "CHECK (hardest_level IS NULL OR hardest_level IN ('easy','mid','hard','hidden'))")
    # 整条没有可定级爬升的线路：把过去顶上的 'mid' 去掉，让"未评级"是真的未评级。
    op.execute("""UPDATE routes SET hardest_level = NULL
                   WHERE NOT EXISTS (
                     SELECT 1 FROM route_segments s
                      WHERE s.route_id = routes.id AND s.difficulty_applicable)""")


def downgrade() -> None:
    raise RuntimeError("Use a database backup to roll back schema changes")
