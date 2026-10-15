"""给演示用户（阿甘）挂一座"我维护的山头"，好让消息页的「我的山头」有真数据。

山大王（自己开山、拿编号）和版主（接管已有山头的留言板）是两种身份，
这里演示的是**版主**：把一条已有线路上的主峰交给阿甘维护。
可重复执行。

    docker compose exec api python /srv/seeds/seed_demo_king.py
"""
import sys
from pathlib import Path

sys.path.insert(0, "/srv")
for cand in ("/srv", str(Path(__file__).resolve().parents[1] / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402


def main():
    with engine.begin() as c:
        uid = c.execute(text("SELECT id FROM users WHERE wx_openid = 'demo_openid'")).scalar()
        if not uid:
            raise SystemExit("找不到演示用户（wx_openid=demo_openid）")
        # 挑一个"热闹"的线路主峰：有点赞过的打卡、有留言可看的那个
        # （别挑 QS-TEST01 这种演示用的测试点位，名字就叫"测试山顶"）
        pid = c.execute(text("""SELECT pt.id, pt.code FROM points pt
                                WHERE pt.route_id IS NOT NULL AND pt.index_in_route > 0
                                ORDER BY (SELECT count(*) FROM visits v WHERE v.point_id = pt.id) DESC,
                                         pt.id LIMIT 1""")).first()
        if not pid:
            raise SystemExit("库里没有线路主峰点位")
        c.execute(text("""UPDATE points SET maintainer_id = NULL
                          WHERE maintainer_id = :u AND id <> :p"""),
                  {"u": uid, "p": pid.id})
        c.execute(text("""DELETE FROM claims
                          WHERE user_id = :u AND target_key LIKE 'master:%'
                            AND target_key <> :k"""),
                  {"u": uid, "k": "master:" + pid.code})
        c.execute(text("UPDATE points SET maintainer_id = :u WHERE id = :p"),
                  {"u": uid, "p": pid.id})
        c.execute(text("""INSERT INTO claims (user_id, target_key, target_name, kind, nickname, contact)
                          VALUES (:u, :k, :n, 'peak', '阿甘', 'wx: agan')
                          ON CONFLICT (target_key) DO NOTHING"""),
                  {"u": uid, "k": "master:" + pid.code, "n": pid.code})
        print(f"✓ 用户 {uid} 成为 {pid.code} 的维护人（版主）")


if __name__ == "__main__":
    main()
