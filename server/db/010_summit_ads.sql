-- ============ 山头广告位 ============
-- 每个山头有一个轮播广告位，能挂几条由**维护人的等级**决定
-- （初级 1、常客 2、山主 3、巡山使 5，见 main.py 的 ADS_BY_LEVEL）。
-- 内容必须过审才上架：pending → approved / rejected，运营在维护台审。
--
-- 广播（维护人发通知）这轮先不做，所以表里只放广告；
-- 以后要加广播，加一个 kind 列即可，不用另起一张表。

CREATE TABLE IF NOT EXISTS summit_ads (
  id            BIGSERIAL PRIMARY KEY,
  point_id      BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  author_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,   -- 投放的维护人
  title         TEXT NOT NULL,                                    -- ≤ 14 字，轮播卡主标题
  body          TEXT,                                             -- 一行说明
  image         TEXT,                                             -- 图（没有就用山头场景图）
  link          TEXT,                                             -- 点「去看看」去哪
  starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  reviewed_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  reject_reason TEXT,
  weight        INT NOT NULL DEFAULT 0,                            -- 越大越靠前
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ads_point  ON summit_ads (point_id, status);
CREATE INDEX IF NOT EXISTS idx_ads_active ON summit_ads (status, ends_at DESC);
