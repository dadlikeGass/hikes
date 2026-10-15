-- ============ 赛事路线（导入赛事官方赛道用）============
-- 赛事路线和我们的徒步路书共用 routes 表：它们都是"一条线 + 分段 + 沿途山顶"，
-- 画图、算难度、算用时的产物完全一样，分成两张表只会让接口写两遍。
--
-- 差别只有两点，所以只加列、不加表：
--   1) 赛事路线**必须标年份**——同一条赛道每年都会改线，2025 的线和 2026 的线
--      是不同的路线，不能互相覆盖。唯一键因此是 slug（slug 里带年份）。
--   2) 需要记住赛事名、组别、举办地、轨迹来源，方便回查。

ALTER TABLE routes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'hike';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS year SMALLINT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS race_event  TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS race_category TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS race_place  TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS race_source TEXT;   -- 官方轨迹原始地址

-- kind 只允许两类；赛事路线必须写年份，否则数据进不来（在数据层拦住，不靠脚本自觉）
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_kind_check;
ALTER TABLE routes ADD CONSTRAINT routes_kind_check
  CHECK (kind IN ('hike', 'race'));
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_race_year_check;
ALTER TABLE routes ADD CONSTRAINT routes_race_year_check
  CHECK (kind <> 'race' OR (year IS NOT NULL AND year BETWEEN 1990 AND 2100));

CREATE INDEX IF NOT EXISTS idx_routes_kind_year ON routes (kind, year);
