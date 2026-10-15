"""把赛事官方赛道导进数据库（routes + route_segments + route_peaks）。

数据来自 pipeline/build_races.py 生成的 pipeline/out/race_routes.json。
与 seed_routes.py 的区别：**不清库**。徒步路书那 12 条是产品的正餐，
赛事路线是加菜，导入时只按 slug upsert 自己，绝不 TRUNCATE 别人的数据。

赛事路线一律 kind='race' 且 year 非空（schema 里有约束兜底）；
slug 里带年份，所以「2026 的云丘山 100K」和「2027 的云丘山 100K」是两条路线，
年年改线也不会互相覆盖。

用法：docker compose exec api python /srv/seeds/seed_race_routes.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for cand in ("/srv/routes-data/race_routes.json", ROOT / "pipeline/out/race_routes.json"):
    if Path(cand).exists():
        SRC = Path(cand)
        break
else:
    raise SystemExit("找不到 race_routes.json，先在仓库根目录跑 python3 pipeline/build_races.py")

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
   path, profile, status, kind, year, race_event, race_category, race_place, race_source)
VALUES
  (:slug, :name, :sub, :city, :km, :up, :down, :hl, :hours, :kcal,
   CAST(:est AS jsonb), :pc, CAST(:path AS jsonb), CAST(:prof AS jsonb),
   'published', 'race', :year, :event, :category, :place, :source)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, sub = EXCLUDED.sub, city = EXCLUDED.city,
  km = EXCLUDED.km, up = EXCLUDED.up, down = EXCLUDED.down,
  hardest_level = EXCLUDED.hardest_level, hours = EXCLUDED.hours, kcal = EXCLUDED.kcal,
  est = EXCLUDED.est, peak_count = EXCLUDED.peak_count,
  path = EXCLUDED.path, profile = EXCLUDED.profile, status = EXCLUDED.status,
  kind = 'race', year = EXCLUDED.year, race_event = EXCLUDED.race_event,
  race_category = EXCLUDED.race_category, race_place = EXCLUDED.race_place,
  race_source = EXCLUDED.race_source, updated_at = now()
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
                "prof": json.dumps(r["profile"]), "year": r["year"],
                "event": r.get("event"), "category": r.get("category"),
                "place": r.get("place"), "source": r.get("source"),
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

    years = sorted({r["year"] for r in data.values()})
    print(f"✓ {len(data)} 条赛事路线 / {n_seg} 段 / {n_peak} 个沿途山顶 / 年份 {years}")


if __name__ == "__main__":
    main()
