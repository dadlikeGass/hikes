-- ============ 关注 / 想去 ============
-- 「想去」不只是客户端的一个列表：热门登顶排行榜的"用户关注度"就是数它。
-- 所以必须落库——一个只在 localStorage 里的数字，服务端永远算不出热度。
-- target_key 用前端那套 key：线路 = slug，山顶 = slug-idx，用户自建点位 = p-{code}。
CREATE TABLE IF NOT EXISTS wants (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT   NOT NULL CHECK (kind IN ('peak','trail','junction')),
  target_key TEXT   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 同一个人对同一个东西只算一次关注
  UNIQUE (user_id, kind, target_key)
);
CREATE INDEX IF NOT EXISTS idx_wants_target ON wants (target_key);
