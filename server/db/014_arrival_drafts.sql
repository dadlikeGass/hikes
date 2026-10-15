-- Guest arrival keepsakes and unpublished public-comment drafts.
CREATE TABLE IF NOT EXISTS guest_arrival_drafts (
  id BIGSERIAL PRIMARY KEY,
  guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  point_id BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  private_note TEXT CHECK (private_note IS NULL OR char_length(private_note) <= 500),
  public_comment_draft TEXT CHECK (public_comment_draft IS NULL OR char_length(public_comment_draft) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guest_id, point_id),
  CHECK (private_note IS NOT NULL OR public_comment_draft IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS account_arrival_drafts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  point_id BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  private_note TEXT CHECK (private_note IS NULL OR char_length(private_note) <= 500),
  public_comment_draft TEXT CHECK (public_comment_draft IS NULL OR char_length(public_comment_draft) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, point_id),
  CHECK (private_note IS NOT NULL OR public_comment_draft IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_guest_arrival_drafts_guest ON guest_arrival_drafts (guest_id);
CREATE INDEX IF NOT EXISTS idx_account_arrival_drafts_user ON account_arrival_drafts (user_id, updated_at DESC);
