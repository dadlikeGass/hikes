-- 线路来源：不管是六只脚抓的、赛事官网下的，还是以后用户自己传的，
-- 都要能回答"这条线是从哪来的"。赛事那批先写在 race_source 里，
-- 这里补一个通用列并把它继承过来，前端和管理台只认 source 一个字段。

ALTER TABLE routes ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE routes
   SET source = race_source
 WHERE source IS NULL AND race_source IS NOT NULL;
