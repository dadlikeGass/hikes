"""私人未来信三种解锁模式与上榜设置。

旧信日期按 Asia/Shanghai 当天零点转换。失败则事务整体回滚；正式回退用备份。
验收：date 必须有 unlock_at，checkin 必须有目标点，open 无需条件。
"""
from alembic import op

revision = "0012_private_letters"
down_revision = "0011_ascent_courses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
      ALTER TABLE letters ADD COLUMN unlock_mode TEXT NOT NULL DEFAULT 'date';
      ALTER TABLE letters ADD COLUMN status TEXT NOT NULL DEFAULT 'sealed';
      ALTER TABLE letters RENAME COLUMN unlock_at TO old_unlock_date;
      ALTER TABLE letters ADD COLUMN unlock_at TIMESTAMPTZ;
      UPDATE letters SET unlock_at = old_unlock_date::timestamp AT TIME ZONE 'Asia/Shanghai';
      ALTER TABLE letters DROP COLUMN old_unlock_date;
      ALTER TABLE letters ADD CONSTRAINT letters_mode_check CHECK (
        (unlock_mode = 'date' AND unlock_at IS NOT NULL)
        OR (unlock_mode = 'checkin' AND point_id IS NOT NULL AND unlock_at IS NULL)
        OR (unlock_mode = 'open' AND unlock_at IS NULL)
      );
      ALTER TABLE letters ADD CONSTRAINT letters_status_check
        CHECK (status IN ('sealed','unlocked','deleted'));
      ALTER TABLE users ADD COLUMN leaderboard_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
