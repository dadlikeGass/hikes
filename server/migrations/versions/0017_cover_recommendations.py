"""路书封面推荐：关联线路的山头负责人/成员只能推荐，不能直接替换官方封面。"""
from alembic import op

revision = "0017_cover_recommendations"
down_revision = "0016_king_review_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS route_cover_recommendations (
          id BIGSERIAL PRIMARY KEY,
          submission_id BIGINT NOT NULL
            REFERENCES route_cover_submissions(id) ON DELETE CASCADE,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note TEXT CHECK (note IS NULL OR char_length(note) <= 300),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (submission_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_route_cover_recommendations_submission
          ON route_cover_recommendations (submission_id, created_at DESC);
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
