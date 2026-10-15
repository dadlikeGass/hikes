-- Collaboration is scoped to one board and never grants advertising rights.
ALTER TABLE system_roles DROP CONSTRAINT IF EXISTS system_roles_role_check;
ALTER TABLE system_roles ADD CONSTRAINT system_roles_role_check
  CHECK (role IN ('ad_reviewer', 'place_curator', 'collaboration_reviewer'));

CREATE TABLE IF NOT EXISTS board_collaboration_applications (
  id BIGSERIAL PRIMARY KEY,
  board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  applicant_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 8 AND 500),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CHECK (status = 'pending' OR reviewer_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_board_collaboration_current
  ON board_collaboration_applications (board_id, applicant_id)
  WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_board_collaboration_queue
  ON board_collaboration_applications (status, created_at DESC);
