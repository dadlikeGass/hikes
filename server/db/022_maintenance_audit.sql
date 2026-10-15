-- Append-only audit trail for scoped maintenance and review decisions.
CREATE TABLE IF NOT EXISTS maintenance_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN
    ('point.update', 'comment.hide', 'collaboration.review', 'ad.review', 'ad.promote')),
  board_id BIGINT REFERENCES boards(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  previous JSONB NOT NULL DEFAULT '{}'::jsonb,
  current JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maintenance_audit_target
  ON maintenance_audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_audit_board
  ON maintenance_audit_logs (board_id, created_at DESC);
