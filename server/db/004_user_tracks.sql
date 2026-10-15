-- ============ 用户上传的轨迹 ============
-- 用户自己的轨迹 ≠ 我们的线路：分开存，能互相关联。
-- 用途一（最重要）：给山径拼图提供**候选**——他走过这条线，格子先摆出来（灰色），
-- 扫码才点亮。上传不等于去过，这条必须在数据层就分清楚。
CREATE TABLE IF NOT EXISTS user_tracks (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT,                       -- 默认取文件名，用户不用填
  source       TEXT NOT NULL DEFAULT 'gpx',-- gpx / kml / tcx（tcx 待支持）
  source_app   TEXT,                       -- 从文件 creator 字段猜：garmin / coros / …
  distance_m   INT,
  gain_m       INT,
  loss_m       INT,
  point_count  INT,
  -- 解析产物：和 pipeline 输出同一个形状，前端直接画
  path         JSONB,                      -- 归一化 0-1 坐标
  profile      JSONB,                      -- 海拔剖面
  peaks        JSONB,                      -- 识别到的山顶 [{km, ele, rel, lat, lng}]
  segments     JSONB,                      -- 分段难度
  status       TEXT NOT NULL DEFAULT 'ready'
                 CHECK (status IN ('parsing','ready','failed')),
  fail_reason  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_tracks_user ON user_tracks (user_id, created_at DESC);
