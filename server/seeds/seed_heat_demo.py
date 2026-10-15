"""演示用的热度数据 —— 热门登顶榜和山径拼图要有东西可看。

真实扫码进来之前全是 0，等于没法验收 UI。这个脚本造：
  ① 24 个演示用户对 6 座山头的主峰扫码（近 30 天铺开，近 7 天一批）
  ② 一批"想去 / 收藏"（关注度）
  ③ 阿甘本人对 3 座山的**山脚 + 主峰**各打一次卡 → 山径拼图点亮 + 有登顶用时

打卡打的是**主峰那个点位**（`SF-01` 这种），不是线路级的假点位——
真实扫码本来就会打在具体的点上。

**所有数据都带 `demo_heat_` / 演示前缀，--clear 一次清干净。**

    docker compose exec api python /srv/seeds/seed_heat_demo.py
    docker compose exec api python /srv/seeds/seed_heat_demo.py --clear
"""
import random
import sys

sys.path.insert(0, "/srv")
sys.path.insert(0, "/srv/seeds")
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402
from backfill_peak_points import ABBR  # noqa: E402

random.seed(20261012)          # 每次跑出来一样，方便对照 UI
N_USERS = 24

# 手工写死比随机更像真的：越短越出名的线路越热
PLAN = [
    ("sanfeng", 14, 9),
    ("xiangbala", 11, 7),
    ("baiwala", 8, 6),
    ("jiankou", 7, 5),
    ("donglingshan", 5, 4),
    ("xiaotaoren", 3, 2),
]

# 主峰 = 最难那条爬升段通向的顶。和 app.main 里的口径必须一致
MAIN_PEAK_POINT = """
    WITH hard AS (
      SELECT DISTINCT ON (route_id) route_id, to_km
      FROM route_segments WHERE kind = 'climb'
      ORDER BY route_id,
               CASE level WHEN 'hidden' THEN 3 WHEN 'hard' THEN 2
                          WHEN 'mid' THEN 1 ELSE 0 END DESC, pct DESC
    ), mp AS (
      SELECT DISTINCT ON (rp.route_id) rp.route_id, rp.idx + 1 AS idx
      FROM route_peaks rp JOIN hard h ON h.route_id = rp.route_id
      ORDER BY rp.route_id, abs(rp.km - h.to_km)
    )
    SELECT pt.id FROM points pt
    JOIN mp ON mp.route_id = pt.route_id AND mp.idx = pt.index_in_route
    WHERE pt.route_id = :rid
"""


def clear(c):
    n = c.execute(text("DELETE FROM points WHERE code LIKE 'DEMO-%'")).rowcount
    u = c.execute(text("DELETE FROM users WHERE wx_openid LIKE 'demo_heat_%'")).rowcount
    left = c.execute(text("""SELECT count(*) AS n FROM visits v JOIN users u ON u.id = v.user_id
                             WHERE u.wx_openid LIKE 'demo_heat_%'""")).scalar()
    print(f"✓ 清掉演示数据：{n} 个旧假点位 · {u} 个演示用户（打卡与关注随之级联删除），"
          f"残留 {left} 条")


def main():
    with engine.begin() as c:
        if "--clear" in sys.argv:
            return clear(c)
        clear(c)

        uids = []
        for i in range(N_USERS):
            uids.append(c.execute(text("""INSERT INTO users (wx_openid, nickname)
                VALUES (:o, :n) ON CONFLICT (wx_openid)
                DO UPDATE SET nickname = EXCLUDED.nickname RETURNING id"""),
                {"o": f"demo_heat_{i}", "n": f"演示山友{i + 1:02d}"}).scalar())

        me = c.execute(text("SELECT id FROM users WHERE wx_openid = 'demo_openid'")).scalar()
        my_routes = {PLAN[0][0], PLAN[1][0], PLAN[3][0]}
        MY_PARTIAL = {"baiwala"}       # 只扫了山顶、没扫山脚的那条

        n_visit = n_want = 0
        for slug, heat7, wants in PLAN:
            r = c.execute(text("SELECT id, name FROM routes WHERE slug = :s"), {"s": slug}).first()
            if not r:
                print(f"  跳过 {slug}：库里没这条线路")
                continue
            summit = c.execute(text(MAIN_PEAK_POINT), {"rid": r.id}).scalar()
            start = c.execute(text("SELECT id FROM points WHERE code = :c"),
                              {"c": ABBR[slug] + "-S"}).scalar()
            if not summit or not start:
                print(f"  跳过 {slug}：点位还没补，先跑 backfill_peak_points.py")
                continue

            # 近 7 天一批 + 8–30 天前一批，让"本周热度"和"月热度"不是同一个数
            days = [random.randint(0, 6) for _ in range(heat7)]
            days += [random.randint(8, 30) for _ in range(heat7 * 2)]
            people = random.sample(uids, min(len(uids), heat7 * 3 + 2))
            for i, d in enumerate(days):
                secs = random.randint(105, 420) * 60 if random.random() < 0.6 else None
                got = c.execute(text("""INSERT INTO visits
                    (user_id, point_id, seq, visit_date, source, created_at, duration_sec)
                    VALUES (:u, :p, 1, CURRENT_DATE - :d, 'manual',
                            now() - make_interval(days => :d, mins => :m), :s)
                    ON CONFLICT (user_id, point_id, visit_date) DO NOTHING
                    RETURNING id"""),
                    {"u": people[i % len(people)], "p": summit, "d": d, "s": secs,
                     "m": random.randint(0, 1439)}).scalar()
                n_visit += 1 if got else 0

            for uid in random.sample(uids, min(len(uids), wants)):
                c.execute(text("""INSERT INTO wants (user_id, kind, target_key)
                    VALUES (:u, 'trail', :t) ON CONFLICT DO NOTHING"""),
                    {"u": uid, "t": slug})
                n_want += 1
            for uid in random.sample(uids, min(len(uids), max(1, wants // 2))):
                c.execute(text("""INSERT INTO wants (user_id, kind, target_key)
                    VALUES (:u, 'peak', :t) ON CONFLICT DO NOTHING"""),
                    {"u": uid, "t": f"{slug}-1"})
                n_want += 1

            # 阿甘：
            #   完整记录（山脚 + 主峰都打）→ 拼图格子里有登顶时间
            #   只打了主峰               → 只点亮，格子里写"已到"，没有时间
            if me and slug in my_routes:
                d = random.randint(2, 20)
                climb_min = random.randint(120, 300)
                c.execute(text("""INSERT INTO visits
                    (user_id, point_id, seq, visit_date, source, created_at, duration_sec)
                    VALUES (:u, :p, 1, CURRENT_DATE - :d, 'manual',
                            now() - make_interval(days => :d, mins => :m), NULL)
                    ON CONFLICT (user_id, point_id, visit_date) DO NOTHING"""),
                    {"u": me, "p": start, "d": d, "m": climb_min})
                c.execute(text("""INSERT INTO visits
                    (user_id, point_id, seq, visit_date, source, created_at, duration_sec)
                    VALUES (:u, :p, 1, CURRENT_DATE - :d, 'manual',
                            now() - make_interval(days => :d), :s)
                    ON CONFLICT (user_id, point_id, visit_date) DO NOTHING"""),
                    {"u": me, "p": summit, "d": d, "s": climb_min * 60})
                n_visit += 2
            elif me and slug in MY_PARTIAL:
                c.execute(text("""INSERT INTO visits
                    (user_id, point_id, seq, visit_date, source, created_at, duration_sec)
                    VALUES (:u, :p, 1, CURRENT_DATE - :d, 'manual',
                            now() - make_interval(days => :d, mins => :m), NULL)
                    ON CONFLICT (user_id, point_id, visit_date) DO NOTHING"""),
                    {"u": me, "p": summit, "d": random.randint(2, 20),
                     "m": random.randint(0, 1439)})
                n_visit += 1

        # 阿甘的收藏：两条线路 + 两个山顶（"我想去的地方"要真东西可看）
        if me:
            for k, t in (("trail", "jiankou"), ("trail", "yudushan"),
                         ("peak", "p-DLS-02"), ("peak", "p-SF-02")):
                c.execute(text("""INSERT INTO wants (user_id, kind, target_key)
                    VALUES (:u, :k, :t) ON CONFLICT DO NOTHING"""),
                    {"u": me, "k": k, "t": t})

    print(f"✓ 演示热度：{len(PLAN)} 座山头 · {n_visit} 次打卡 · {n_want} 条关注 · "
          f"{N_USERS} 个演示用户")
    print(f"  阿甘在 {len(my_routes)} 座山上留下了山脚 + 主峰的完整记录")
    print("  清掉：docker compose exec api python /srv/seeds/seed_heat_demo.py --clear")


if __name__ == "__main__":
    main()
