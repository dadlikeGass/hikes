"""山脚候选核验：审计日志增加发布 / 驳回两种动作。"""
from alembic import op

revision = "0018_trailhead_review_audit"
down_revision = "0017_cover_recommendations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE maintenance_audit_logs
          DROP CONSTRAINT IF EXISTS maintenance_audit_logs_action_check;
        ALTER TABLE maintenance_audit_logs
          ADD CONSTRAINT maintenance_audit_logs_action_check CHECK (action = ANY (ARRAY[
            'point.update', 'comment.hide', 'comment.appeal_review', 'comment.restore',
            'collaboration.review', 'ad.review', 'ad.promote', 'report.review',
            'master_application.submit', 'master_application.approved',
            'master_application.rejected',
            'king_application.submit', 'king_application.approved',
            'king_application.rejected', 'king_application.needs_info',
            'king_application.withdraw',
            'clan.create', 'clan.review', 'clan.join_review', 'clan.leave',
            'member.remove', 'member.transfer_request', 'member.transfer_accept',
            'member.transfer_review', 'board.pin', 'board.notice', 'cover.review',
            'trailhead.publish', 'trailhead.reject'
          ]));
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
