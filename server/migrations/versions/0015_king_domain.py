"""统一山大王申请、山寨成员关系与路书封面投稿的数据底座。

这一版只新增结构并做兼容回填，不删除历史二维码、打卡、留言或 claims：
* master_applications 扩展为 existing/new 两种目标，并承载私有新山头资料与草稿；
* mountain_members 以「山头」而不是「点位编号」作为权限边界，同一山头只能有一位
  在任负责人（部分唯一索引）；
* 历史 points.maintainer_id / active claims / 已通过的协作申请回填为成员关系；
  同一山头出现多个负责人时只保留一位在任负责人，其余写入人工处理清单，不静默提升；
* 山寨、加入申请、移交申请、通知队列、申请版本和封面投稿都落库。

失败则整版事务回滚；正式回退用发布前备份恢复到 0014。
验收：重复负责人被数据库阻止；历史二维码/打卡/留言仍在；回填可重放不重复。
"""
from alembic import op

revision = "0015_king_domain"
down_revision = "0014_master_applications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        -- ============ 统一申请 ============
        ALTER TABLE master_applications ALTER COLUMN point_id DROP NOT NULL;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS target_kind TEXT
          NOT NULL DEFAULT 'existing';
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS intent TEXT
          NOT NULL DEFAULT 'owner';
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS target_mountain_id BIGINT
          REFERENCES mountains(id) ON DELETE SET NULL;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_point_type TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_name TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_region TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_location_text TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_lat NUMERIC(9,6);
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_lng NUMERIC(9,6);
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_altitude INT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_intro TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS new_gpx_ref TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS nickname TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS contact TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS version INT
          NOT NULL DEFAULT 1;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
          NOT NULL DEFAULT now();
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS needs_info_note TEXT;
        ALTER TABLE master_applications ADD COLUMN IF NOT EXISTS result_role TEXT;

        -- 历史申请给目标山头补齐；新山头申请的 point_id 留在通过时创建。
        UPDATE master_applications ma
           SET target_mountain_id = coalesce(ma.target_mountain_id, pt.mountain_id,
                                             ma.mountain_id)
          FROM points pt
         WHERE ma.point_id = pt.id AND ma.target_mountain_id IS NULL;
        UPDATE master_applications
           SET target_kind = 'existing', intent = 'owner'
         WHERE target_kind IS NULL OR intent IS NULL;
        UPDATE master_applications
           SET submitted_at = coalesce(submitted_at, created_at)
         WHERE status <> 'draft';

        ALTER TABLE master_applications DROP CONSTRAINT IF EXISTS master_applications_status_check;
        ALTER TABLE master_applications ADD CONSTRAINT master_applications_status_check
          CHECK (status IN ('draft','pending','needs_info','approved','rejected',
                            'withdrawn','expired','waiting_clan','pending_confirmation'));
        ALTER TABLE master_applications DROP CONSTRAINT IF EXISTS master_applications_kind_check;
        ALTER TABLE master_applications ADD CONSTRAINT master_applications_kind_check
          CHECK (kind IN ('solo','clan'));
        ALTER TABLE master_applications DROP CONSTRAINT IF EXISTS master_applications_check;
        ALTER TABLE master_applications ADD CONSTRAINT master_applications_closed_reviewer_check
          CHECK (status IN ('draft','pending','needs_info','expired','withdrawn','waiting_clan',
                            'pending_confirmation') OR reviewer_id IS NOT NULL);
        ALTER TABLE master_applications DROP CONSTRAINT IF EXISTS master_applications_expectations_check;
        -- 计划要求经营计划 20–2000 字；历史短文本补一句来源说明，避免升级失败。
        UPDATE master_applications
           SET expectations = expectations || '（历史申请，沿用原字段）'
         WHERE char_length(expectations) < 20;
        UPDATE master_applications
           SET expectations = left(expectations, 2000)
         WHERE char_length(expectations) > 2000;
        ALTER TABLE master_applications ADD CONSTRAINT master_applications_expectations_check
          CHECK (char_length(expectations) BETWEEN 20 AND 2000);
        ALTER TABLE master_applications DROP CONSTRAINT IF EXISTS master_applications_target_check;
        ALTER TABLE master_applications ADD CONSTRAINT master_applications_target_check CHECK (
          (target_kind = 'existing' AND (point_id IS NOT NULL OR target_mountain_id IS NOT NULL))
          OR (target_kind = 'new' AND point_id IS NULL AND new_point_type IN ('peak','junction')
              AND nullif(btrim(new_name), '') IS NOT NULL)
        );
        ALTER TABLE master_applications DROP CONSTRAINT IF EXISTS master_applications_intent_check;
        ALTER TABLE master_applications ADD CONSTRAINT master_applications_intent_check
          CHECK (intent IN ('owner','join'));
        ALTER TABLE master_applications DROP CONSTRAINT IF EXISTS master_applications_result_role_check;
        ALTER TABLE master_applications ADD CONSTRAINT master_applications_result_role_check
          CHECK (result_role IS NULL OR result_role IN ('owner','member'));
        ALTER TABLE master_applications DROP CONSTRAINT IF EXISTS master_applications_contact_check;
        ALTER TABLE master_applications ADD CONSTRAINT master_applications_contact_check
          CHECK (contact IS NULL OR char_length(contact) <= 200);

        -- 旧唯一索引按 point_id 建；新山头没有 point_id，另按山头/申请人防重复。
        DROP INDEX IF EXISTS uq_master_application_open;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_master_application_open_existing
          ON master_applications (coalesce(target_mountain_id, mountain_id), applicant_id)
          WHERE status IN ('pending','needs_info') AND target_kind = 'existing';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_master_application_open_new
          ON master_applications (lower(new_name), new_point_type, applicant_id)
          WHERE status IN ('pending','needs_info') AND target_kind = 'new';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_master_application_draft_new_target
          ON master_applications (applicant_id, lower(new_name), new_point_type)
          WHERE status = 'draft' AND target_kind = 'new';
        CREATE INDEX IF NOT EXISTS idx_king_application_target
          ON master_applications (target_mountain_id, status, created_at DESC);

        CREATE TABLE IF NOT EXISTS king_application_versions (
          id BIGSERIAL PRIMARY KEY,
          application_id BIGINT NOT NULL REFERENCES master_applications(id) ON DELETE CASCADE,
          revision INT NOT NULL,
          snapshot JSONB NOT NULL,
          created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (application_id, revision)
        );

        -- ============ 山头成员身份 ============
        CREATE TABLE IF NOT EXISTS mountain_members (
          id BIGSERIAL PRIMARY KEY,
          mountain_id BIGINT NOT NULL REFERENCES mountains(id) ON DELETE RESTRICT,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('owner','member')),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','left','removed')),
          source_application_id BIGINT REFERENCES master_applications(id)
            ON DELETE SET NULL,
          granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ended_at TIMESTAMPTZ,
          note TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_mountain_active_owner
          ON mountain_members (mountain_id) WHERE role = 'owner' AND status = 'active';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_mountain_active_member
          ON mountain_members (mountain_id, user_id) WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_mountain_members_user
          ON mountain_members (user_id, status, role);

        CREATE TABLE IF NOT EXISTS king_migration_conflicts (
          id BIGSERIAL PRIMARY KEY,
          mountain_id BIGINT REFERENCES mountains(id) ON DELETE CASCADE,
          user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          source TEXT NOT NULL,
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          resolved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (mountain_id, user_id, source)
        );

        -- 历史负责人：先按 points.maintainer_id，再按 active claims；同一山头只回填一位。
        WITH candidates AS (
          SELECT pt.mountain_id, pt.maintainer_id AS user_id, 1 AS priority,
                 'points.maintainer_id'::text AS source, pt.code
            FROM points pt
           WHERE pt.mountain_id IS NOT NULL AND pt.maintainer_id IS NOT NULL
          UNION ALL
          SELECT pt.mountain_id, cl.user_id, 2 AS priority,
                 'claims.active'::text AS source, pt.code
            FROM claims cl
            JOIN short_links sl ON sl.code = cl.code
            JOIN points pt ON pt.id = sl.point_id
           WHERE cl.status = 'active' AND pt.mountain_id IS NOT NULL
        ), deduped AS (
          SELECT DISTINCT ON (c.mountain_id, c.user_id) c.*
            FROM candidates c
           ORDER BY c.mountain_id, c.user_id, c.priority, c.code
        ), ranked AS (
          SELECT c.*, row_number() OVER (
            PARTITION BY c.mountain_id ORDER BY c.priority, c.code, c.user_id
          ) AS rn
            FROM deduped c
        ), chosen AS (
          SELECT r.* FROM ranked r
           WHERE r.rn = 1
             AND NOT EXISTS (SELECT 1 FROM mountain_members mm
                              WHERE mm.mountain_id = r.mountain_id
                                AND mm.role = 'owner' AND mm.status = 'active')
        )
        INSERT INTO mountain_members (mountain_id, user_id, role, status, granted_by, note)
        SELECT mountain_id, user_id, 'owner', 'active', user_id,
               '兼容回填：' || source || ' / ' || code
          FROM chosen
        ON CONFLICT DO NOTHING;

        WITH candidates AS (
          SELECT pt.mountain_id, pt.maintainer_id AS user_id, 1 AS priority,
                 'points.maintainer_id'::text AS source, pt.code
            FROM points pt
           WHERE pt.mountain_id IS NOT NULL AND pt.maintainer_id IS NOT NULL
          UNION ALL
          SELECT pt.mountain_id, cl.user_id, 2 AS priority,
                 'claims.active'::text AS source, pt.code
            FROM claims cl
            JOIN short_links sl ON sl.code = cl.code
            JOIN points pt ON pt.id = sl.point_id
           WHERE cl.status = 'active' AND pt.mountain_id IS NOT NULL
        ), deduped AS (
          SELECT DISTINCT ON (c.mountain_id, c.user_id) c.*
            FROM candidates c
           ORDER BY c.mountain_id, c.user_id, c.priority, c.code
        ), ranked AS (
          SELECT c.*, row_number() OVER (
            PARTITION BY c.mountain_id ORDER BY c.priority, c.code, c.user_id
          ) AS rn
            FROM deduped c
        )
        INSERT INTO king_migration_conflicts (mountain_id, user_id, source, detail)
        SELECT r.mountain_id, r.user_id, r.source,
               jsonb_build_object('pointCode', r.code, 'reason', 'multiple_legacy_owners')
          FROM ranked r
         WHERE r.rn > 1
        ON CONFLICT (mountain_id, user_id, source) DO NOTHING;

        INSERT INTO mountain_members (mountain_id, user_id, role, status, granted_by, note)
        SELECT b.mountain_id, ca.applicant_id, 'member', 'active', ca.reviewer_id,
               '兼容回填：board_collaboration_applications#' || ca.id
          FROM board_collaboration_applications ca
          JOIN boards b ON b.id = ca.board_id AND b.board_type = 'summit'
         WHERE ca.status = 'approved' AND b.mountain_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM mountain_members mm
                            WHERE mm.mountain_id = b.mountain_id
                              AND mm.user_id = ca.applicant_id AND mm.status = 'active')
        ON CONFLICT DO NOTHING;

        -- ============ 山寨与加入申请 ============
        CREATE TABLE IF NOT EXISTS clans (
          id BIGSERIAL PRIMARY KEY,
          mountain_id BIGINT NOT NULL UNIQUE REFERENCES mountains(id) ON DELETE RESTRICT,
          name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
          intro TEXT NOT NULL CHECK (char_length(intro) BETWEEN 20 AND 2000),
          collaboration_plan TEXT NOT NULL
            CHECK (char_length(collaboration_plan) BETWEEN 20 AND 2000),
          recruit_requirements TEXT NOT NULL
            CHECK (char_length(recruit_requirements) BETWEEN 10 AND 1000),
          recruiting BOOLEAN NOT NULL DEFAULT TRUE,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('draft','pending','active','rejected','closed')),
          created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          review_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          reviewed_at TIMESTAMPTZ,
          CHECK (status IN ('draft','pending') OR reviewer_id IS NOT NULL)
        );

        CREATE TABLE IF NOT EXISTS clan_join_applications (
          id BIGSERIAL PRIMARY KEY,
          clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
          applicant_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message TEXT NOT NULL CHECK (char_length(message) BETWEEN 20 AND 1000),
          status TEXT NOT NULL DEFAULT 'pending_confirmation'
            CHECK (status IN ('intent','pending_confirmation','pending','approved',
                              'rejected','withdrawn')),
          owner_opinion TEXT,
          owner_opinion_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
          owner_opinion_at TIMESTAMPTZ,
          reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          review_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          confirmed_at TIMESTAMPTZ,
          reviewed_at TIMESTAMPTZ,
          CHECK (status <> 'approved' OR reviewer_id IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_clan_join_open
          ON clan_join_applications (clan_id, applicant_id)
          WHERE status IN ('intent','pending_confirmation','pending');

        CREATE TABLE IF NOT EXISTS transfer_applications (
          id BIGSERIAL PRIMARY KEY,
          mountain_id BIGINT NOT NULL REFERENCES mountains(id) ON DELETE RESTRICT,
          from_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          to_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          note TEXT NOT NULL CHECK (char_length(note) BETWEEN 20 AND 1000),
          status TEXT NOT NULL DEFAULT 'pending_accept'
            CHECK (status IN ('pending_accept','ready_review','approved','rejected',
                              'cancelled','expired')),
          accepted_at TIMESTAMPTZ,
          reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          review_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          reviewed_at TIMESTAMPTZ,
          CHECK (from_user_id <> to_user_id),
          CHECK (status NOT IN ('approved','rejected') OR reviewer_id IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_open
          ON transfer_applications (mountain_id)
          WHERE status IN ('pending_accept','ready_review');

        CREATE TABLE IF NOT EXISTS king_notifications (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          link TEXT,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_king_notifications_user
          ON king_notifications (user_id, created_at DESC);

        -- ============ 留言板：置顶与隐藏理由 ============
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS hidden_reason TEXT;
        CREATE INDEX IF NOT EXISTS idx_comments_pinned
          ON comments (point_id, pinned, created_at DESC) WHERE pinned;

        -- ============ 路书封面投稿 ============
        CREATE TABLE IF NOT EXISTS route_cover_submissions (
          id BIGSERIAL PRIMARY KEY,
          route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
          submitter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          storage_key TEXT NOT NULL,
          thumbnail_key TEXT,
          photographer TEXT NOT NULL CHECK (char_length(photographer) BETWEEN 1 AND 80),
          shot_at DATE,
          caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 300),
          license_confirmed BOOLEAN NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','approved','rejected','withdrawn','deleted')),
          reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
          review_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          reviewed_at TIMESTAMPTZ,
          CHECK (license_confirmed),
          CHECK (status NOT IN ('approved','rejected') OR reviewer_id IS NOT NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_route_cover_approved
          ON route_cover_submissions (route_id) WHERE status = 'approved';
        CREATE INDEX IF NOT EXISTS idx_route_cover_queue
          ON route_cover_submissions (status, created_at);

        -- ============ 审计动作 ============
        ALTER TABLE maintenance_audit_logs DROP CONSTRAINT IF EXISTS maintenance_audit_logs_action_check;
        ALTER TABLE maintenance_audit_logs ADD CONSTRAINT maintenance_audit_logs_action_check CHECK (
          action = ANY (ARRAY['point.update','comment.hide','comment.appeal_review',
            'comment.restore','collaboration.review','ad.review','ad.promote','report.review',
            'master_application.submit','master_application.approved',
            'master_application.rejected','king_application.submit',
            'king_application.approved','king_application.rejected',
            'king_application.needs_info','king_application.withdraw',
            'clan.create','clan.review','clan.join_review','clan.leave',
            'member.remove','member.transfer_request','member.transfer_accept',
            'member.transfer_review','board.pin','board.notice','cover.review']));
    """)


def downgrade() -> None:
    raise RuntimeError("This migration is restored from a pre-release backup")
