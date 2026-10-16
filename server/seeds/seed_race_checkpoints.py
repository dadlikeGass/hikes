"""把赛事打卡点导进库，并给沿途山顶标出最近的打卡点。

数据来自 pipeline/build.py --source races 生成的 pipeline/out/race_checkpoints.json
（打卡点已经在同一步里投到赛道折线上，里程与分段/山顶用同一把尺子）。
可重复执行：先清掉该线路的旧打卡点再写入（序号会重排），山顶标注同样重算。

用法：docker compose exec api python /srv/seeds/seed_race_checkpoints.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for cand in ("/srv/routes-data/race_checkpoints.json",
             ROOT / "pipeline/out/race_checkpoints.json"):
    if Path(cand).exists():
        SRC = Path(cand)
        break
else:
    raise SystemExit("找不到 race_checkpoints.json，先跑 python3 pipeline/build.py --source races")

sys.path.insert(0, "/srv")
for cand in ("/srv", str(ROOT / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

INSERT = """
INSERT INTO route_checkpoints
  (route_id, no, name, km, altitude, lat, lng, off_track_m, geom, source, notes)
VALUES (:rid, :no, :name, :km, :alt, :lat, :lng, :off,
        CASE WHEN :lat IS NULL THEN NULL
             ELSE ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) END, 'official', :notes)
"""


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    n_cp = n_peak = 0
    missed = []
    with engine.begin() as c:
        for slug, rows in data.items():
            rid = c.execute(text("SELECT id FROM routes WHERE slug = :s"), {"s": slug}).scalar()
            if not rid:
                missed.append(slug)
                continue
            c.execute(text("DELETE FROM route_checkpoints WHERE route_id = :r AND source = 'official'"), {"r": rid})
            for r in rows:
                c.execute(text(INSERT), {"rid": rid, "no": r["no"], "name": r["name"],
                                         "km": r["km"], "alt": r.get("altitude"),
                                         "lat": r.get("lat"), "lng": r.get("lng"),
                                         "off": r.get("off_track_m"),
                                         "notes": "待核验：离赛道较远" if r.get("status") == "verify" else None})
                n_cp += 1

            if not rows:
                continue
            # 沿途山顶 → 最近打卡点（两者都是"沿线第几公里"，直接比里程）
            peaks = c.execute(text("SELECT id, km FROM route_peaks WHERE route_id = :r"),
                              {"r": rid}).mappings().all()
            for p in peaks:
                near = min(rows, key=lambda r: abs(float(r["km"]) - float(p["km"])))
                c.execute(text("""UPDATE route_peaks SET near_cp = :n, near_cp_m = :d
                                  WHERE id = :id"""),
                          {"n": near["name"], "id": p["id"],
                           "d": round(abs(float(near["km"]) - float(p["km"])) * 1000)})
                n_peak += 1

    print(f"✓ {len(data) - len(missed)} 条线路 · {n_cp} 个打卡点 · {n_peak} 个沿途山顶标了最近打卡点")
    if missed:
        print(f"  跳过（库里没有这条路线）：{missed[:5]}{' …' if len(missed) > 5 else ''}")


if __name__ == "__main__":
    main()
