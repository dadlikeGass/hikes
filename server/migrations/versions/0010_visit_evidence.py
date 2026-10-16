"""到访现场时间和定位证据，为扫码与 GPS 共用打卡铺设字段。

旧记录沿用 created_at，证据标为 legacy，避免历史记录自动取得公开排名资格。
失败时 PostgreSQL 事务回滚整个修订；正式回退使用发布前备份。
验收：旧行数不变、occurred_at 与 recorded_at 均非空、幂等键区分游客与账号。
"""
from alembic import op

revision = "0010_visit_evidence"
down_revision = "0009_mountain_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE visits
          ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS evidence_level TEXT NOT NULL DEFAULT 'legacy',
          ADD COLUMN IF NOT EXISTS accuracy_m INT,
          ADD COLUMN IF NOT EXISTS location_geom GEOMETRY(Point,4326);
        UPDATE visits SET occurred_at = created_at WHERE occurred_at IS NULL;
        UPDATE visits SET recorded_at = created_at WHERE recorded_at IS NULL;
        ALTER TABLE visits ALTER COLUMN occurred_at SET NOT NULL;
        ALTER TABLE visits ALTER COLUMN recorded_at SET NOT NULL;
        ALTER TABLE visits ALTER COLUMN occurred_at SET DEFAULT now();
        ALTER TABLE visits ALTER COLUMN recorded_at SET DEFAULT now();
        CREATE INDEX IF NOT EXISTS idx_visits_point_occurred
          ON visits (point_id, occurred_at DESC);
        CREATE TABLE IF NOT EXISTS visit_submission_receipts (
          id BIGSERIAL PRIMARY KEY,
          identity_type TEXT NOT NULL CHECK (identity_type IN ('guest','user')),
          identity_id BIGINT NOT NULL,
          client_uuid UUID NOT NULL,
          payload_hash TEXT NOT NULL,
          canonical_visit_id BIGINT REFERENCES visits(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (identity_type, identity_id, client_uuid)
        );
        CREATE INDEX IF NOT EXISTS idx_visit_receipts_visit
          ON visit_submission_receipts (canonical_visit_id);
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
