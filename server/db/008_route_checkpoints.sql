-- ============ 赛道打卡点（组委会 GPX 里的 <wpt>）============
-- 赛事 GPX 带官方检查点/补给点：云丘山的「U1-轻野」、大境门的「D2啕北营村21.3」、
-- 宁海的「CP1 峰山」、崇礼168 的「CP4太舞滑雪小镇」……组委会只给经纬度，
-- 我们贴回轨迹算出它在本条线路的第几公里和海拔，界面上就能标在海拔剖面和分段里。
--
-- 单独建表、不塞进 points：points 是"我们自己拥有、可扫码打卡、发编号"的点位，
-- 打卡点是别人的赛事信息，混进去会污染山头榜和二维码空间。

CREATE TABLE IF NOT EXISTS route_checkpoints (
  id          BIGSERIAL PRIMARY KEY,
  route_id    BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  no          SMALLINT NOT NULL,             -- 按里程排序的序号，不是官方编号
  name        TEXT NOT NULL,                 -- 官方点名，原样保留
  km          NUMERIC(6,2) NOT NULL,
  altitude    INT,
  lat         NUMERIC(9,6),
  lng         NUMERIC(9,6),
  off_track_m INT,                           -- 点名离轨迹多少米（>300 的基本是录错的点）
  geom        GEOMETRY(Point, 4326),
  UNIQUE (route_id, no)
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_route ON route_checkpoints (route_id, km);

-- 沿途山顶旁边是哪个打卡点：赛道上的顶大多就在某个补给点附近，
-- 有了这个关系，界面上能写「离 CP3 东坪 400 m」，不用只写"名称待定"。
ALTER TABLE route_peaks ADD COLUMN IF NOT EXISTS near_cp    TEXT;
ALTER TABLE route_peaks ADD COLUMN IF NOT EXISTS near_cp_m  INT;
