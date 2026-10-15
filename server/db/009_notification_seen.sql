-- 「我关注的山头有新留言」需要一个"上次看到哪儿"的游标。
-- 放 users 上一列就够：消息页是"自上次打开以来的新留言"这种粗粒度提醒，
-- 不需要每条通知一行记录（那套要单独的通知表和已读表，1.0 用不上）。

ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
