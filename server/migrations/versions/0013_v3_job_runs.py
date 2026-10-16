"""保养作业台账：记录配对补偿与坐标清理最后一次成功/失败时间。

计划 T8 要求"落实定时清理和配对补偿，记录最后成功时间与失败日志"。
没有台账就只能靠翻容器日志回答"上次清理是什么时候跑的"。
失败则事务整体回滚；正式回退用发布前备份。
验收：job_runs 一行一次运行，status 只允许 running/ok/failed。
"""
from alembic import op

revision = "0013_v3_job_runs"
down_revision = "0012_private_letters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS job_runs (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running'
            CHECK (status IN ('running','ok','failed')),
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          finished_at TIMESTAMPTZ,
          detail JSONB NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE INDEX IF NOT EXISTS idx_job_runs_name_started
          ON job_runs (name, started_at DESC);
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
