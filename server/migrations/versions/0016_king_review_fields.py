"""统一申请补充山寨与负责人意见字段。

0015 已把申请、成员、封面投稿等表建好；这一版只给 master_applications 补上
山寨关联、负责人意见与申请人确认时间，保证「负责人意见 ≠ 最终授权」能在同一行追溯。
失败整版回滚；回退按发布前备份。
"""
from alembic import op

revision = "0016_king_review_fields"
down_revision = "0015_king_domain"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS clan_id BIGINT
          REFERENCES clans(id) ON DELETE SET NULL;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS owner_opinion TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS owner_opinion_by BIGINT
          REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS owner_opinion_at TIMESTAMPTZ;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
        CREATE INDEX IF NOT EXISTS idx_king_application_clan
          ON master_applications (clan_id, status, created_at DESC);

        CREATE TABLE IF NOT EXISTS point_edit_suggestions (
          id BIGSERIAL PRIMARY KEY,
          point_id BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
          author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          field_name TEXT NOT NULL CHECK (field_name IN ('name','intro','guide','first_ascent','ascent_method')),
          proposed_value TEXT NOT NULL CHECK (char_length(proposed_value) BETWEEN 1 AND 2000),
          reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','accepted','rejected')),
          reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          review_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          reviewed_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_point_edit_suggestions_queue
          ON point_edit_suggestions (status, created_at);

        CREATE TABLE IF NOT EXISTS member_removal_applications (
          id BIGSERIAL PRIMARY KEY,
          mountain_id BIGINT NOT NULL REFERENCES mountains(id) ON DELETE RESTRICT,
          member_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          requested_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','approved','rejected','cancelled')),
          reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          review_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          reviewed_at TIMESTAMPTZ
        );
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
