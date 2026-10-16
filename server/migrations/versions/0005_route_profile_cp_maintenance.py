"""路线真实海拔、方向难度与维护人 CP 字段。

在既有数据库上补绝对海拔采样、难度适用标记及维护 CP 元信息；历史赛事 CP 标记为官方来源。
"""
from alembic import op

revision = "0005_route_profile_cp"
down_revision = "0004_account_deletion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE routes ADD COLUMN IF NOT EXISTS elevation_m JSONB")
    op.execute("ALTER TABLE routes ALTER COLUMN elevation_m SET DEFAULT '[]'::jsonb")
    op.execute("UPDATE routes SET elevation_m = '[]'::jsonb WHERE elevation_m IS NULL")
    op.execute("ALTER TABLE route_segments ADD COLUMN IF NOT EXISTS difficulty_applicable BOOLEAN NOT NULL DEFAULT true")
    op.execute("UPDATE route_segments SET difficulty_applicable = (kind = 'climb' AND rise > 0 AND pct > 3), level = CASE WHEN kind = 'climb' AND rise > 0 AND pct > 3 THEN level ELSE 'easy' END")
    op.execute("ALTER TABLE route_checkpoints ADD COLUMN IF NOT EXISTS supply_type TEXT")
    op.execute("ALTER TABLE route_checkpoints ADD COLUMN IF NOT EXISTS notes TEXT")
    op.execute("ALTER TABLE route_checkpoints ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'official'")
    op.execute("ALTER TABLE route_checkpoints DROP CONSTRAINT IF EXISTS route_checkpoints_source_check")
    op.execute("ALTER TABLE route_checkpoints ADD CONSTRAINT route_checkpoints_source_check CHECK (source IN ('official', 'maintainer'))")
    op.execute("ALTER TABLE route_peaks ADD COLUMN IF NOT EXISTS name_status TEXT NOT NULL DEFAULT 'unconfirmed'")
    op.execute("ALTER TABLE route_peaks DROP CONSTRAINT IF EXISTS route_peaks_name_status_check")
    op.execute("ALTER TABLE route_peaks ADD CONSTRAINT route_peaks_name_status_check CHECK (name_status IN ('unconfirmed', 'candidate', 'confirmed'))")
    op.execute("UPDATE route_peaks SET name_status = 'candidate' WHERE name IS NOT NULL AND name_status = 'unconfirmed'")
    op.execute("UPDATE route_peaks rp SET name_status = 'confirmed' FROM mountains m WHERE m.id = rp.mountain_id AND m.name_status = 'confirmed' AND m.name IS NOT NULL")
    op.execute("UPDATE mountains m SET name_status = 'confirmed' FROM route_peaks rp WHERE rp.mountain_id = m.id AND rp.name_status = 'confirmed' AND rp.name IS NOT NULL")
    op.execute("ALTER TABLE route_peaks ADD COLUMN IF NOT EXISTS elevation_m INT")
    op.execute("UPDATE route_peaks SET elevation_m = altitude")
    op.execute("ALTER TABLE route_peak_candidates DROP CONSTRAINT IF EXISTS route_peak_candidates_source_check")


def downgrade() -> None:
    raise RuntimeError("Use a database backup to roll back schema changes")
