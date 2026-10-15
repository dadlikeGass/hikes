-- Keep a publish receipt so a lost response can be retried without duplicating a comment.
CREATE TABLE IF NOT EXISTS arrival_publish_receipts (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  point_id BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, point_id)
);
