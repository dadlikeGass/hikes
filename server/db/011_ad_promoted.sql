-- 广告位的默认落位是**留言板最上面**（第一屏之外）。
-- 只有审核时被"提升"的广告才出现在第一屏 —— 这是运营手里的一个开关，
-- 不是投放的人自己想要的：默认全在留言区，能不能上首屏由审核决定。

ALTER TABLE summit_ads ADD COLUMN IF NOT EXISTS promoted BOOLEAN NOT NULL DEFAULT false;
