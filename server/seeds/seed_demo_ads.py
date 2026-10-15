"""造几条"已过审"的广告，让首页 / 路书页的广告轮播有内容可看。

真实的投放流程是：维护人在山头上投 → pending → 运营在维护台审。
这里直接按已过审写入（reviwed_by=1），用于演示和自测。可重复执行（按标题去重）。

    docker compose exec api python /srv/seeds/seed_demo_ads.py
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

# (山头编号, 主标题, 一行说明, 跳转, 权重)
ADS = [
    ("SF-01", "大觉寺 · 免费热水", "越野跑者凭号码布免费灌热水，院里能停车", "#/places", 30),
    ("DLS-02", "周末拼车去灵山", "每周六 7:00 苹果园地铁站集合，AA 油费", "#/places", 20),
    ("CN-01", "泰山夜爬装备租赁", "红门游客中心寄存 + 租头灯 20 元/晚", "#/places", 10),
    ("XBL-01", "八大处 · 山脚面馆", "凭本条 8 折，赛后一碗热的", "#/places", 5),
]


def main():
    n = 0
    with engine.begin() as c:
        # 样例广告挂在别的演示账号名下：**不占演示登录账号（阿甘）的广告位**，
        # 他留着一个空位，可以在页面上完整走一遍"投放 → 待审 → 过审上架"。
        uid = c.execute(text("SELECT id FROM users WHERE nickname = '演示山友01'")).scalar() or 1
        for code, title, body, link, weight in ADS:
            pid = c.execute(text("SELECT id FROM points WHERE code = :c"), {"c": code}).scalar()
            if not pid:
                print(f"  跳过 {code}（库里没这个点位）")
                continue
            exists = c.execute(text("""SELECT 1 AS x FROM summit_ads
                                       WHERE point_id = :p AND title = :t"""),
                               {"p": pid, "t": title}).scalar()
            if exists:
                continue
            c.execute(text("""INSERT INTO summit_ads
                (point_id, author_id, title, body, link, ends_at, status,
                 reviewed_by, reviewed_at, weight)
                VALUES (:p, :u, :t, :b, :l, now() + interval '30 days',
                        'approved', :u, now(), :w)"""),
                {"p": pid, "u": uid, "t": title, "b": body, "l": link, "w": weight})
            n += 1
    print(f"✓ 新增 {n} 条已过审广告（共 {len(ADS)} 条样例）")


if __name__ == "__main__":
    main()
