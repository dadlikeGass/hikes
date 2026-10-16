"""山大王/版主申请表：从"先到先得"改成"申请 + 3 天审核"。

为什么要有这张表：原来两个人抢同一座山时，第二个人的请求直接 409 丢掉，
运营看不到"还有谁想维护"；现在申请先落库，审核时能看到全部候选人与理由。

字段口径（产品口径见 docs/API.md「占山为王申请」）：
* kind：solo = 山大王（单人独占），clan = 山寨（多人协作，同山可多人）；
* reason / expectations：申请理由与成为版主后的期待，都要写够字数（DB 层也校验）；
* visits_per_month：申请人承诺一个月能去几次，1–30；
* due_at：3 天审核期，到期未处理由接口惰性置为 expired（不假装通过）；
* 同一个人对同一个点位只能有一份待审申请（部分唯一索引）；
* 同一座山同一时间只能有一个"审核通过的单人山大王"（部分唯一索引兜底）。

失败则事务整体回滚；正式回退用发布前备份。
"""
from alembic import op

revision = "0014_master_applications"
down_revision = "0013_v3_job_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS master_applications (
          id BIGSERIAL PRIMARY KEY,
          applicant_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          point_id BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
          mountain_id BIGINT REFERENCES mountains(id) ON DELETE SET NULL,
          kind TEXT NOT NULL CHECK (kind IN ('solo','clan')),
          reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 1000),
          expectations TEXT NOT NULL CHECK (char_length(expectations) BETWEEN 10 AND 1000),
          visits_per_month INT NOT NULL CHECK (visits_per_month BETWEEN 1 AND 30),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','approved','rejected','expired','withdrawn')),
          due_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '3 days',
          reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          review_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          decided_at TIMESTAMPTZ,
          -- 有人拍板才有审核人：approved/rejected 必须留审核人；
          -- pending/expired/withdrawn 没有（失效是系统按 3 天期限自动置的，撤回是本人）
          CHECK (status IN ('pending','expired','withdrawn') OR reviewer_id IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_master_application_open
          ON master_applications (point_id, applicant_id) WHERE status = 'pending';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_master_application_solo
          ON master_applications (point_id)
          WHERE status = 'approved' AND kind = 'solo';
        CREATE INDEX IF NOT EXISTS idx_master_applications_queue
          ON master_applications (status, created_at);
        CREATE INDEX IF NOT EXISTS idx_master_applications_applicant
          ON master_applications (applicant_id, created_at DESC);

        -- 审计动作清单要放行维护申请：提交、通过、驳回
        ALTER TABLE maintenance_audit_logs DROP CONSTRAINT IF EXISTS maintenance_audit_logs_action_check;
        ALTER TABLE maintenance_audit_logs ADD CONSTRAINT maintenance_audit_logs_action_check CHECK (
          action = ANY (ARRAY['point.update','comment.hide','comment.appeal_review',
            'comment.restore','collaboration.review','ad.review','ad.promote','report.review',
            'master_application.submit','master_application.approved',
            'master_application.rejected']));
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
