-- System operators are granted out of band; registration never grants this role.
CREATE TABLE IF NOT EXISTS system_roles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ad_reviewer')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
