-- One appeal per hide event; a later hide after restoration has a new audit id.
ALTER TABLE system_roles DROP CONSTRAINT IF EXISTS system_roles_role_check;
ALTER TABLE system_roles ADD CONSTRAINT system_roles_role_check
  CHECK (role IN ('ad_reviewer', 'place_curator', 'collaboration_reviewer', 'content_reviewer'));

ALTER TABLE maintenance_audit_logs DROP CONSTRAINT IF EXISTS maintenance_audit_logs_action_check;
ALTER TABLE maintenance_audit_logs ADD CONSTRAINT maintenance_audit_logs_action_check
  CHECK (action IN ('point.update', 'comment.hide', 'comment.appeal_review',
    'comment.restore', 'collaboration.review', 'ad.review', 'ad.promote'));

CREATE TABLE IF NOT EXISTS comment_appeals (
  id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  hide_event_id BIGINT NOT NULL DEFAULT 0,
  author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'restored', 'rejected')),
  reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (comment_id, hide_event_id),
  CHECK (status = 'pending' OR reviewer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_comment_appeals_queue
  ON comment_appeals (status, created_at);
