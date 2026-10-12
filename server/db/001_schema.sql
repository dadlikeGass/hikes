-- 到此一游 · 初始 schema
-- 对应 docs/PLAN.md 第六节。约束：1 万用户以下单机可跑，但主键/唯一索引/外键一次定对。
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============ 用户 ============
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  wx_openid     TEXT UNIQUE,                 -- 小程序
  wx_unionid    TEXT UNIQUE,                 -- 跨端唯一
  nickname      TEXT,                        -- 允许为空，扫码后补
  avatar        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()   -- 7 日回访率靠它算
);
CREATE INDEX idx_users_last_seen ON users (last_seen_at);

-- ============ 线路 ============
CREATE TABLE routes (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  sub         TEXT,
  km          NUMERIC(6,2)  NOT NULL,
  up          INT           NOT NULL,        -- 原始高程 + 3m 滞回，不用平滑高程
  down        INT           NOT NULL,
  -- 线路不做整体难度分级。这里存"最难那一段"的等级，另给用时与消耗估算。
  hardest_level TEXT        NOT NULL CHECK (hardest_level IN ('easy','mid','hard','hidden')),
  hours       NUMERIC(4,1),                  -- 平均完成时间（估算）
  kcal        INT,                           -- 大致消耗（估算）
  est         JSONB,                         -- 估算所用的假设参数，前端要标注"估算"
  peak_count  SMALLINT      NOT NULL DEFAULT 0,
  path        JSONB         NOT NULL,        -- 归一化 0-1 坐标，前端直接画 SVG
  profile     JSONB         NOT NULL,        -- 归一化海拔剖面
  geom        GEOMETRY(LineString, 4326),
  status      TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_routes_geom  ON routes USING GIST (geom);
CREATE INDEX idx_routes_level ON routes (hardest_level, status);

-- ============ 线路分段（难度着色的数据源）============
CREATE TABLE route_segments (
  id          BIGSERIAL PRIMARY KEY,
  route_id    BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  no          SMALLINT NOT NULL,
  from_km     NUMERIC(6,2) NOT NULL,
  to_km       NUMERIC(6,2) NOT NULL,
  km          NUMERIC(6,2) NOT NULL,
  rise        INT     NOT NULL,
  pct         SMALLINT NOT NULL,             -- 平均坡度 %
  level       TEXT    NOT NULL CHECK (level IN ('easy','mid','hard','hidden')),
  kind        TEXT    NOT NULL CHECK (kind IN ('climb','desc','flat')),
  source      TEXT    NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  confirmed   BOOLEAN NOT NULL DEFAULT false,  -- 自动算的是基础判断，维护人确认后才算正式
  geom        GEOMETRY(LineString, 4326),
  UNIQUE (route_id, no)
);
CREATE INDEX idx_segments_route ON route_segments (route_id, no);

-- ============ 线路上的山顶 ============
CREATE TABLE route_peaks (
  id        BIGSERIAL PRIMARY KEY,
  route_id  BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  idx       SMALLINT NOT NULL,
  km        NUMERIC(6,2) NOT NULL,
  altitude  INT NOT NULL,
  rise      INT NOT NULL,                    -- 自上一个山顶（或起点）的爬升
  -- 以下三项要实地采集/维护人填，不能靠推算
  name      TEXT,                            -- 主峰真名；空则前端显示"未命名山顶"
  lat       NUMERIC(9,6),
  lng       NUMERIC(9,6),
  geom      GEOMETRY(Point, 4326),
  UNIQUE (route_id, idx)
);
CREATE INDEX idx_peaks_geom ON route_peaks USING GIST (geom);

-- ============ 点位（二维码指向的东西）============
CREATE TABLE points (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,      -- 生成后不可变，二维码里印的就是它
  type            TEXT NOT NULL CHECK (type IN ('peak','junction','trailhead')),
  name            TEXT NOT NULL,
  route_id        BIGINT REFERENCES routes(id) ON DELETE SET NULL,
  index_in_route  SMALLINT,
  total_in_route  SMALLINT,
  level           TEXT NOT NULL DEFAULT 'mid'
                    CHECK (level IN ('easy','mid','hard','hidden')),
  altitude        INT,                       -- 仅山峰
  guide           JSONB,                     -- {arrow,title,desc,next}
  geom            GEOMETRY(Point, 4326) NOT NULL,
  maintainer_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  version         INT  NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_points_geom   ON points USING GIST (geom);
CREATE INDEX idx_points_route  ON points (route_id, index_in_route);
CREATE INDEX idx_points_status ON points (status);

-- 短链：/p/{code} 做 302。这一层独立，页面结构随便改都不用重印标牌
CREATE TABLE short_links (
  code       TEXT PRIMARY KEY,
  point_id   BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ 打卡 ============
CREATE TABLE visits (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  point_id    BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  seq         INT    NOT NULL,
  visit_date  DATE   NOT NULL DEFAULT CURRENT_DATE,
  source      TEXT   NOT NULL DEFAULT 'scan' CHECK (source IN ('scan','nearby','manual')),
  duration_sec INT,                          -- 本次用时；填了才进最快用时榜
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- "同一人 + 同一点位 + 同一天只算一次" 靠约束实现，不靠代码判重
  UNIQUE (user_id, point_id, visit_date)
);
CREATE INDEX idx_visits_user   ON visits (user_id, created_at DESC);
CREATE INDEX idx_visits_point  ON visits (point_id, created_at DESC);

-- ============ 留言 ============
CREATE TABLE comments (
  id          BIGSERIAL PRIMARY KEY,
  point_id    BIGINT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT   NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
  like_count  INT    NOT NULL DEFAULT 0,
  bad_count   INT    NOT NULL DEFAULT 0,
  status      TEXT   NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','flagged','hidden')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 游标分页用 (created_at, id)，不用 offset
CREATE INDEX idx_comments_point ON comments (point_id, created_at DESC, id DESC);
CREATE INDEX idx_comments_flagged ON comments (status) WHERE status <> 'normal';

CREATE TABLE comment_votes (
  id          BIGSERIAL PRIMARY KEY,
  comment_id  BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value       TEXT   NOT NULL CHECK (value IN ('like','bad')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id)
);

-- ============ 扫码 / 埋点（三个验证问题全靠这两张）============
CREATE TABLE scans (
  id         BIGSERIAL PRIMARY KEY,
  point_id   BIGINT REFERENCES points(id) ON DELETE SET NULL,
  code       TEXT,
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ua         TEXT,
  ip_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scans_point ON scans (point_id, created_at DESC);

CREATE TABLE events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  props      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_name ON events (name, created_at DESC);
CREATE INDEX idx_events_user ON events (user_id, created_at DESC);

-- ============ 未来信 ============
CREATE TABLE letters (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  point_id   BIGINT REFERENCES points(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  unlock_at  DATE NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_letters_unlock ON letters (user_id, unlock_at);
