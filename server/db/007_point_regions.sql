-- ============ 点位的行政地区 ============
-- 山头页要按「本市 / 本省 / 本国 / 海外」筛，就得知道每个点位在哪一级行政区。
-- 之前只有线路有 city（而且格式是"北京 · 海淀 / 门头沟"这种给人看的字符串），
-- 点位自己没有；名山更是只有一个括号里的"（日本）"。
--
-- 拆成三列：country / province / city。省一级用规范简称（北京、浙江、香港…），
-- 市一级能取到就取，取不到留空——**留空代表不知道，不拿省名冒充市名**。

ALTER TABLE points ADD COLUMN IF NOT EXISTS country  TEXT;
ALTER TABLE points ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE points ADD COLUMN IF NOT EXISTS city     TEXT;

CREATE INDEX IF NOT EXISTS idx_points_region ON points (country, province);
