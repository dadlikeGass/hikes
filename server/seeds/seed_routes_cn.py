"""把六只脚抓的区域热门线路导进数据库（routes + route_segments + route_peaks）。

数据来自 pipeline/build_routes_cn.py 生成的 pipeline/out/routes_cn.json。
与 seed_routes.py 的区别同样是**不清库**：按 slug upsert，只动自己这批，
北京那 12 条路书和 33 条赛事路线都不受影响。

这批是徒步线路，kind='hike'（年份不是必填）；来源写进 routes.source，
指回六只脚原轨迹页，方便回查版权与更新。

用法：docker compose exec api python /srv/seeds/seed_routes_cn.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for cand in ("/srv/routes-data/routes_cn.json", ROOT / "pipeline/out/routes_cn.json"):
    if Path(cand).exists():
        SRC = Path(cand)
        break
else:
    raise SystemExit("找不到 routes_cn.json，先在仓库根目录跑 python3 pipeline/build_routes_cn.py")

sys.path.insert(0, "/srv")
for cand in ("/srv", str(ROOT / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

UPSERT = """
INSERT INTO routes
  (slug, name, sub, city, km, up, down, hardest_level, hours, kcal, est, peak_count,
   path, profile, status, kind, source)
VALUES
  (:slug, :name, :sub, :city, :km, :up, :down, :hl, :hours, :kcal,
   CAST(:est AS jsonb), :pc, CAST(:path AS jsonb), CAST(:prof AS jsonb),
   'published', 'hike', :source)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, sub = EXCLUDED.sub, city = EXCLUDED.city,
  km = EXCLUDED.km, up = EXCLUDED.up, down = EXCLUDED.down,
  hardest_level = EXCLUDED.hardest_level, hours = EXCLUDED.hours, kcal = EXCLUDED.kcal,
  est = EXCLUDED.est, peak_count = EXCLUDED.peak_count,
  path = EXCLUDED.path, profile = EXCLUDED.profile, status = EXCLUDED.status,
  source = EXCLUDED.source, updated_at = now()
RETURNING id
"""


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    n_seg = n_peak = 0
    with engine.begin() as c:
        for slug, r in data.items():
            h = r.get("hardest") or {}
            rid = c.execute(text(UPSERT), {
                "slug": slug, "name": r["name"], "sub": r.get("sub"), "city": r.get("city"),
                "km": r["km"], "up": r["up"], "down": r["down"],
                "hl": h.get("level", "mid"), "hours": r.get("hours"), "kcal": r.get("kcal"),
                "est": json.dumps(r.get("est") or {}, ensure_ascii=False),
                "pc": len(r["peaks"]), "path": json.dumps(r["path"]),
                "prof": json.dumps(r["profile"]), "source": r.get("source"),
            }).scalar()

            for s in r["segments"]:
                c.execute(text("""INSERT INTO route_segments
                    (route_id, no, from_km, to_km, km, rise, pct, level, kind, source, confirmed)
                    VALUES (:rid, :no, :f, :t, :km, :rise, :pct, :lv, :kind, 'auto', false)
                    ON CONFLICT (route_id, no) DO UPDATE SET
                      from_km = EXCLUDED.from_km, to_km = EXCLUDED.to_km,
                      km = EXCLUDED.km, rise = EXCLUDED.rise, pct = EXCLUDED.pct,
                      kind = EXCLUDED.kind,
                      level = CASE WHEN route_segments.confirmed THEN route_segments.level
                                   ELSE EXCLUDED.level END"""),
                    {"rid": rid, "no": s["no"], "f": s["from"], "t": s["to"], "km": s["km"],
                     "rise": s["rise"], "pct": s["pct"], "lv": s["level"], "kind": s["kind"]})
                n_seg += 1

            for i, p in enumerate(r["peaks"]):
                prev = r["peaks"][i - 1]["ele"] if i else None
                c.execute(text("""INSERT INTO route_peaks
                    (route_id, idx, km, altitude, rise, lat, lng, geom)
                    VALUES (:rid, :i, :km, :alt, :rise, :lat, :lng,
                            CASE WHEN :lat IS NULL THEN NULL
                                 ELSE ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) END)
                    ON CONFLICT (route_id, idx) DO UPDATE SET
                      km = EXCLUDED.km, altitude = EXCLUDED.altitude, rise = EXCLUDED.rise,
                      lat = EXCLUDED.lat, lng = EXCLUDED.lng, geom = EXCLUDED.geom"""),
                    {"rid": rid, "i": i, "km": p["km"], "alt": p["ele"],
                     "rise": round(p["ele"] - prev) if prev else round(p["rel"]),
                     "lat": p.get("lat"), "lng": p.get("lng")})
                n_peak += 1

    print(f"✓ {len(data)} 条区域线路 / {n_seg} 段 / {n_peak} 个沿途山顶")


if __name__ == "__main__":
    main()
