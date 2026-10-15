-- ============ 游客模式 ============
-- 规则：**游客能看（路书 / 山头 / 留言）+ 能打卡（带时间戳的到此一游凭证）**；
-- 想留言、想给自己起个称呼，一律进注册流程 —— 所以游客唯一的写操作只有"打卡"。
-- 这样就没有匿名 UGC，内容审核的压力从根上少一半。
--
-- 身份怎么认：给设备发一个游客令牌（存 localStorage），不写 cookie、不依赖登录。
-- visits.user_id 因此要允许为空，并且"登录用户"和"游客"必须恰好有一个。

CREATE TABLE IF NOT EXISTS guests (
  id            BIGSERIAL PRIMARY KEY,
  token         TEXT UNIQUE NOT NULL,          -- 客户端持有，丢了就换了新身份
  nickname      TEXT,                          -- 游客不能起称呼（要注册），这列留给以后
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  merged_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL  -- 注册后并入的账号
);

ALTER TABLE visits ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE visits ADD COLUMN IF NOT EXISTS guest_id BIGINT REFERENCES guests(id) ON DELETE SET NULL;

-- 一条打卡要么属于登录用户、要么属于游客，不能都有、也不能都没有
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_owner_check;
ALTER TABLE visits ADD CONSTRAINT visits_owner_check
  CHECK ((user_id IS NULL) <> (guest_id IS NULL));

-- 游客的同日去重（原来那条唯一约束只管登录用户；NULL 在 Postgres 里互不相等）
CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_guest_day
  ON visits (guest_id, point_id, visit_date) WHERE guest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_visits_guest ON visits (guest_id, created_at DESC);
