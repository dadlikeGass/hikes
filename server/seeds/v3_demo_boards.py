"""演示榜单数据（只在开发库/预览环境用，别在生产跑）。

首页的「位次榜」「打卡人数榜」和占山为王页的「登顶榜」都需要一批真实行才能看出样子。
这个脚本按真实点位造一批到访：12 位演示山友 + 3 位演示游客，最近一周里各自去过
几座山。所有行都能一条命令清掉，不会碰任何真实用户的数据。

用法（容器内，工作目录 /srv）：

    python /srv/seeds/v3_demo_boards.py --apply      # 写入演示数据
    python /srv/seeds/v3_demo_boards.py --clear      # 清掉演示数据
    python /srv/seeds/v3_demo_boards.py              # 只报告会影响什么

标记约定：演示账号 `username` 以 `demoboard` 开头、演示游客 `nickname` 以 `演示山友` 开头，
清理只认这两个前缀，删行时连带删它们名下的到访。
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

SHANGHAI = ZoneInfo("Asia/Shanghai")
USER_PREFIX = "demoboard"
GUEST_PREFIX = "演示山友"
NICKNAMES = ["小鱼", "阿川", "阿楠", "老周", "小满", "大韦", "阿吉",
             "林子", "一鸣", "小柯", "阿桐", "山猫"]
GUEST_NICKNAMES = ["演示山友·小鹿", "演示山友·石头", "演示山友·阿布"]
MOUNTAIN_COUNT = 8


def candidates(conn):
    """挑几座有点位坐标的名山当榜单素材；altitude 选出来给 famous() 排序。"""
    return conn.execute(text("""
        SELECT DISTINCT ON (p.mountain_id) p.mountain_id AS mountain_id, p.id AS point_id,
               coalesce(m.name, p.name) AS name,
               coalesce(p.altitude, m.altitude, 0) AS altitude,
               m.heat_tier AS heat_tier, m.annual_visits AS annual_visits
          FROM points p JOIN mountains m ON m.id = p.mountain_id
         WHERE p.type = 'peak' AND p.geom IS NOT NULL AND p.status = 'published'
           AND p.mountain_id IS NOT NULL
           AND coalesce(m.name, p.name) IS NOT NULL      -- 榜上要有名字，别让编号占位
         ORDER BY p.mountain_id, p.id""")).mappings().all()


HEAT_RANK = {"极热": 4, "热门": 3, "较热": 2, "小众": 1}


def annual_weight(text):
    """把"2024 年接待游客 941.09 万人次"里的 941.09 折成数字。
    要取"万"前面那个数——取第一个数字会抓到年份，每座山都变成 2024 万。"""
    import re
    if not text:
        return 0
    found = re.search(r"([0-9]+(?:[.][0-9]+)?)\s*万", text)
    return float(found.group(1)) * 10000 if found else 0


def popular(rows, count):
    """挑"门票卖得多的"：先看人工标的热度档（极热 > 热门 > 较热 > 小众），
    再看年接待量，最后才用海拔兜底。这样榜上出现的是泰山、香山、黄山这些，
    而不是海拔最高但没人买票的雪峰。"""
    return sorted(rows, key=lambda row: (
        -HEAT_RANK.get(row.get("heat_tier") or "", 0),
        -annual_weight(row.get("annual_visits")),
        -(row["altitude"] or 0)))[:count]


def existing_demo(conn):
    users = conn.execute(text("SELECT count(*) FROM users WHERE username LIKE :p"),
                         {"p": USER_PREFIX + "%"}).scalar_one()
    guests = conn.execute(text("SELECT count(*) FROM guests WHERE nickname LIKE :p"),
                          {"p": GUEST_PREFIX + "%"}).scalar_one()
    return {"users": users, "guests": guests}


def clear(conn):
    removed = {}
    # 先删到访：访客的 FK 是 ON DELETE SET NULL，直接删游客会留下"没有归属"的到访行，
    # 撞上 visits_owner_check（user_id / guest_id 恰有一个非空）。
    removed["visits"] = conn.execute(text("""
        DELETE FROM visits
         WHERE user_id IN (SELECT id FROM users WHERE username LIKE :u)
            OR guest_id IN (SELECT id FROM guests WHERE nickname LIKE :g)"""),
        {"u": USER_PREFIX + "%", "g": GUEST_PREFIX + "%"}).rowcount
    removed["users"] = conn.execute(text("DELETE FROM users WHERE username LIKE :u"),
                                    {"u": USER_PREFIX + "%"}).rowcount
    removed["guests"] = conn.execute(text("DELETE FROM guests WHERE nickname LIKE :g"),
                                     {"g": GUEST_PREFIX + "%"}).rowcount
    return removed


def seed(conn):
    mountains = popular(candidates(conn), MOUNTAIN_COUNT)
    if len(mountains) < 3:
        raise SystemExit("库里带坐标的山头太少，先在开发库导入线路数据再来")
    written = {"users": 0, "guests": 0, "visits": 0}
    now = datetime.now(timezone.utc)
    for index, nickname in enumerate(NICKNAMES):
        username = "%s-%02d" % (USER_PREFIX, index)
        if conn.execute(text("SELECT 1 FROM users WHERE username = :u"),
                        {"u": username}).first():
            continue
        uid = conn.execute(text("""INSERT INTO users (username, nickname)
            VALUES (:u, :n) RETURNING id"""), {"u": username, "n": nickname}).scalar_one()
        written["users"] += 1
        # 每人去 2–5 座山；每个山头在最近一周里打 1–3 次（不同天）
        span = 2 + (index * 3) % 4
        for offset in range(span):
            mountain = mountains[(index + offset * 2) % len(mountains)]
            for day in range(1 + (index + offset) % 3):
                when = now - timedelta(days=(offset + day * 2) % 6, hours=index % 7)
                local = when.astimezone(SHANGHAI)
                conn.execute(text("""INSERT INTO visits
                    (user_id, point_id, seq, visit_date, source, occurred_at, recorded_at,
                     evidence_level, accuracy_m)
                    VALUES (:uid, :pid,
                      (SELECT coalesce(max(seq), 0) + 1 FROM visits WHERE point_id = :pid),
                      :day, 'scan', :when, :when + interval '40 seconds',
                      'code', NULL)
                    ON CONFLICT (user_id, point_id, visit_date) DO NOTHING"""),
                    {"uid": uid, "pid": mountain["point_id"], "day": local.date(),
                     "when": when})
                written["visits"] += 1
    for index, nickname in enumerate(GUEST_NICKNAMES):
        token = ("demoboardguest%02d" % index).ljust(48, "0")
        row = conn.execute(text("""INSERT INTO guests (token, nickname)
            VALUES (:t, :n) ON CONFLICT (token) DO NOTHING RETURNING id"""),
            {"t": token, "n": nickname}).first()
        if not row:
            continue
        written["guests"] += 1
        for offset in range(2):
            mountain = mountains[(index * 3 + offset) % len(mountains)]
            when = now - timedelta(days=1 + offset * 2, hours=3 + index)
            conn.execute(text("""INSERT INTO visits
                (guest_id, point_id, seq, visit_date, source, occurred_at, recorded_at,
                 evidence_level)
                VALUES (:gid, :pid,
                  (SELECT coalesce(max(seq), 0) + 1 FROM visits WHERE point_id = :pid),
                  :day, 'scan', :when, :when + interval '50 seconds', 'code')
                ON CONFLICT (guest_id, point_id, visit_date)
                  WHERE guest_id IS NOT NULL DO NOTHING"""),
                {"gid": row[0], "pid": mountain["point_id"],
                 "day": when.astimezone(SHANGHAI).date(), "when": when})
            written["visits"] += 1
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(description="演示榜单数据")
    parser.add_argument("--apply", action="store_true", help="写入演示数据")
    parser.add_argument("--clear", action="store_true", help="清掉演示数据")
    args = parser.parse_args(argv)
    engine = create_engine(os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://hikes:hikes@db:5432/hikes"))
    with engine.begin() as conn:
        print("[demo] 当前库：", conn.execute(text("SELECT current_database()")).scalar_one(),
              "；已有演示账号：", existing_demo(conn))
        if args.clear:
            print("[demo] 清理：", clear(conn))
        elif args.apply:
            print("[demo] 写入：", seed(conn))
        else:
            print("[demo] 预览模式；加 --apply 写入，--clear 清理")
    return 0


if __name__ == "__main__":
    sys.exit(main())
