"""分段记录段内累计与最长连续升降，难度按最长连续爬升定级。

改了什么：
  1. `route_segments` 新增 `up_m` / `down_m`：段内累计爬升与下降（同一套 3 m 滞回，
     和线路累计爬升一致）；新增 `max_rise_m`：段内最大连续爬升。
  2. 重算历史行的 `difficulty_applicable` 与 `level`：过去用**净高差**判定，
     起伏路段会被算没（京西古道 9 km 净升 96 m，实际累计爬升 645 m，整条被判
     "未评级"）。现在只有净下坡（净坡度 < −3%）不定级，其余按**最大连续爬升**
     与净坡度两维度里更高的那档定级——用累计爬升会把"距离"带进难度
     （39 km 的赛段只有 560 m 起伏也会被判 hard）。规则见
     pipeline/build.py:segment_rating() 与 server/app/main.py 的分段 SQL，三处必须一致。
  3. 这三个新列的历史值无法在 SQL 里反算（要读原始 GPX），先置 0，
     由 `server/seeds/seed_routes.py` 重新导入时填上——所以升级后必须重跑种子。

失败会怎样：本文件任一条抛错即整版回滚，`alembic_version` 不前进、退出码非 0。

验收：
  · 重导后 `up_m` / `max_rise_m` 不应再全为 0。
  · 香植线（单向完成）：爬升段 level='hard'，下降段 level IS NULL、kind='desc'。
  · 玉渡山第 1 段：净坡度 3%、最长连续爬升 515 m → 'hard'，不再是不评级。
  · 京西古道（9 km）：第 1 段最长连续爬升 301 m → 'mid'，不再"整条未评级"。
"""
from alembic import op

revision = "0008_segment_climb_run"
down_revision = "0007_segment_difficulty_nullable"
branch_labels = None
depends_on = None

# 与 pipeline/build.py:segment_rating 同一套规则（max_rise_m 尚未回填时按 0 处理，
# 所以这一版只把"净下坡"行改成不定级，其余等重导后由种子写准）。
RATED = "pct >= -3 AND (max_rise_m >= 200 OR pct > 3)"


def upgrade() -> None:
    op.execute("ALTER TABLE route_segments ADD COLUMN IF NOT EXISTS up_m INT NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE route_segments ADD COLUMN IF NOT EXISTS down_m INT NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE route_segments ADD COLUMN IF NOT EXISTS max_rise_m INT NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE route_segments ADD CONSTRAINT route_segments_up_m_check "
               "CHECK (up_m >= 0 AND down_m >= 0 AND max_rise_m >= 0)")
    op.execute(f"UPDATE route_segments SET difficulty_applicable = ({RATED}), "
               f"level = CASE WHEN confirmed THEN level "
               f"WHEN {RATED} THEN level ELSE NULL END "
               f"WHERE source = 'auto'")
    op.execute("""UPDATE routes SET hardest_level = NULL
                   WHERE NOT EXISTS (
                     SELECT 1 FROM route_segments s
                      WHERE s.route_id = routes.id AND s.difficulty_applicable)""")


def downgrade() -> None:
    raise RuntimeError("Use a database backup to roll back schema changes")
