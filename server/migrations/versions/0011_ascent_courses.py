"""上登路线与成绩：明确路线身份，避免同山不同入口混排。

旧到访不自动生成公开成绩。失败则修订事务整体回滚；正式回退用备份。
验收：路线可禁榜，成绩按路线/身份/业务日唯一。
"""
from alembic import op

revision = "0011_ascent_courses"
down_revision = "0010_visit_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
      CREATE TABLE ascent_courses (
        id BIGSERIAL PRIMARY KEY,
        mountain_id BIGINT NOT NULL REFERENCES mountains(id) ON DELETE RESTRICT,
        start_point_id BIGINT NOT NULL REFERENCES points(id) ON DELETE RESTRICT,
        end_point_id BIGINT NOT NULL REFERENCES points(id) ON DELETE RESTRICT,
        trail_segment_id BIGINT REFERENCES trail_segments(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        distance_m INT,
        gain_m INT,
        min_duration_s INT NOT NULL DEFAULT 300,
        ranking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        CHECK (start_point_id <> end_point_id),
        CHECK (min_duration_s > 0),
        UNIQUE (mountain_id, start_point_id, end_point_id, name)
      );
      CREATE INDEX idx_ascent_courses_mountain ON ascent_courses (mountain_id);
      CREATE TABLE segment_efforts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
        guest_id BIGINT REFERENCES guests(id) ON DELETE CASCADE,
        course_id BIGINT NOT NULL REFERENCES ascent_courses(id) ON DELETE RESTRICT,
        start_visit_id BIGINT NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
        end_visit_id BIGINT NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
        visit_date DATE NOT NULL,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        duration_s INT NOT NULL CHECK (duration_s > 0),
        eligible BOOLEAN NOT NULL DEFAULT FALSE,
        excluded_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (num_nonnulls(user_id, guest_id) = 1),
        CHECK (end_at > start_at),
        UNIQUE (course_id, start_visit_id, end_visit_id)
      );
      CREATE UNIQUE INDEX idx_effort_user_day ON segment_efforts
        (user_id, course_id, visit_date) WHERE user_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_effort_guest_day ON segment_efforts
        (guest_id, course_id, visit_date) WHERE guest_id IS NOT NULL;
      CREATE INDEX idx_effort_course_duration ON segment_efforts
        (course_id, eligible, duration_s);
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
