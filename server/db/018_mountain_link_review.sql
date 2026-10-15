-- A curator may link reviewed mountain identities. Keep an audit trail and
-- allow one account to hold both advertising and place-curation roles.
ALTER TABLE system_roles DROP CONSTRAINT IF EXISTS system_roles_pkey;
ALTER TABLE system_roles ADD PRIMARY KEY (user_id, role);
ALTER TABLE system_roles DROP CONSTRAINT IF EXISTS system_roles_role_check;
ALTER TABLE system_roles ADD CONSTRAINT system_roles_role_check
  CHECK (role IN ('ad_reviewer', 'place_curator'));

CREATE TABLE IF NOT EXISTS mountain_identity_links (
  id BIGSERIAL PRIMARY KEY,
  source_mountain_id BIGINT NOT NULL REFERENCES mountains(id) ON DELETE RESTRICT,
  target_mountain_id BIGINT NOT NULL REFERENCES mountains(id) ON DELETE RESTRICT,
  reviewed_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evidence TEXT NOT NULL CHECK (char_length(evidence) >= 8),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_mountain_id <> target_mountain_id)
);
