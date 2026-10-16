"""山头档案字段：mountains 增加描述性列，承接「中国热门徒步登山山峰 100 座」这类研究数据。

改了什么：
  `mountains` 新增 9 列 —— region（省 · 市/县）、area_group（北京周边 / 华东 …）、
  range_name（所属山脉）、intro（一句话简介）、heat_tier（极热 / 热门 / 较热 / 小众）、
  annual_visits（年登顶或到访人次，含口径）、summit_time（平均登顶时间）、
  route_hint（常规登顶路线）、provenance（JSONB，记录坐标与人次的数据来源）。

为什么这么拆：
  `mountains` 原本只有**身份**字段（stable_key / name / altitude / geom / name_status，
  见 013 迁移）。跨线路的同山合并必须人工核实（`mountain_identity_links`，见 018），
  但"这座山多高、怎么上、多少人爬、数据从哪来"是描述，可以批量导入。
  两者分列，就不会有人为了补一段简介去动 stable_key 或 name_status。
  身份仍然是：一个山头一行，stable_key 唯一，合并只走人工链接。

失败会怎样：本文件任一条抛错即整版回滚，`alembic_version` 不前进、退出码非 0。

验收：
  · `\\d mountains` 出现 9 个新列；heat_tier 只接受 极热/热门/较热/小众（或 NULL）。
  · `python /srv/pipeline/import_china_peaks.py --dry` 能读到档案字段并打印去重结果。
  · 旧行不受影响：新列默认为 NULL，provenance 默认 '{}'。
"""
from alembic import op

revision = "0009_mountain_profile"
down_revision = "0008_segment_climb_run"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE mountains
          ADD COLUMN IF NOT EXISTS region        TEXT,
          ADD COLUMN IF NOT EXISTS area_group    TEXT,
          ADD COLUMN IF NOT EXISTS range_name    TEXT,
          ADD COLUMN IF NOT EXISTS intro         TEXT,
          ADD COLUMN IF NOT EXISTS heat_tier     TEXT,
          ADD COLUMN IF NOT EXISTS annual_visits TEXT,
          ADD COLUMN IF NOT EXISTS summit_time   TEXT,
          ADD COLUMN IF NOT EXISTS route_hint    TEXT,
          ADD COLUMN IF NOT EXISTS provenance    JSONB NOT NULL DEFAULT '{}'::jsonb
    """)
    # 约束单独加，重复执行时什么都不做（alembic 重放、半升级的库都能补上）
    op.execute("""
        DO $$ BEGIN
          ALTER TABLE mountains ADD CONSTRAINT mountains_heat_tier_check
            CHECK (heat_tier IS NULL OR heat_tier IN ('极热', '热门', '较热', '小众'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_mountains_region ON mountains (region)")
