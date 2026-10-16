-- V3 T1 只读数据体检：不写任何一行，可以在开发库/生产副本上直接跑。
--   docker exec -i hikes-db-1 psql -U hikes -d hikes -f - < server/tests/v3_data_audit.sql
-- 输出用于回答：点位有没有坐标、有没有挂到山上、一座山有没有可区分的多条路线，
-- 也就是"哪些点位现在不能开放 GPS 打卡、哪些路线不能上公开榜"。

\pset pager off
\echo == 1. 点位数与证据覆盖率 ==
SELECT type,
       count(*) AS total,
       count(geom) AS with_geom,
       count(mountain_id) AS with_mountain,
       count(*) FILTER (WHERE status <> 'published') AS not_published
  FROM points GROUP BY type ORDER BY total DESC;

\echo == 2. 缺坐标点位（GPS 打卡必须关闭；名单前 20 条）==
SELECT code, type, name, status FROM points WHERE geom IS NULL ORDER BY code LIMIT 20;
SELECT count(*) AS missing_geom_total FROM points WHERE geom IS NULL;

\echo == 3. 缺山峰关联点位（不得进入山级汇总；名单前 20 条）==
SELECT code, type, name, status FROM points WHERE mountain_id IS NULL ORDER BY code LIMIT 20;
SELECT count(*) AS missing_mountain_total FROM points WHERE mountain_id IS NULL;

\echo == 4. 一座山上的点位数（可能配置上登路线的山）==
SELECT count(*) AS mountains_with_two_points FROM (
  SELECT mountain_id FROM points WHERE mountain_id IS NOT NULL
   GROUP BY mountain_id HAVING count(*) >= 2) t;

\echo == 5. 同一座山同时具备"峰顶"和"非峰顶（起点）"的数量 ==
-- 只有 >0 才可能配置出真实可核实的上登路线；=0 说明试点路线需要先实地补点。
SELECT count(*) AS mountains_with_peak_and_start FROM (
  SELECT mountain_id FROM points WHERE mountain_id IS NOT NULL
   GROUP BY mountain_id
  HAVING count(*) FILTER (WHERE type = 'peak') >= 1
     AND count(*) FILTER (WHERE type <> 'peak') >= 1) t;

\echo == 6. 同名/同坐标点位（同山多码要能识别，避免人数重复）==
SELECT mountain_id, count(*) AS same_name_points, min(name) AS name
  FROM points WHERE mountain_id IS NOT NULL AND name IS NOT NULL
 GROUP BY mountain_id, name HAVING count(*) > 1 ORDER BY same_name_points DESC LIMIT 10;

\echo == 7. 已有到访的证据等级分布（历史记录不得自动获得排名资格）==
SELECT evidence_level, count(*) AS visits, count(occurred_at) AS with_occurred,
       count(recorded_at) AS with_recorded
  FROM visits GROUP BY evidence_level ORDER BY visits DESC;

\echo == 8. 迁移台账与约束是否存在 ==
SELECT version_num FROM alembic_version;
SELECT conname FROM pg_constraint
 WHERE conname IN ('visits_owner_check','letters_mode_check','letters_status_check')
 ORDER BY conname;
SELECT indexname FROM pg_indexes
 WHERE indexname IN ('uq_visits_guest_day','visits_user_id_point_id_visit_date_key',
                     'idx_effort_user_day','idx_effort_guest_day')
 ORDER BY indexname;
