"""把 pipeline/out/routes.json 的 12 条北京线路导入数据库。

用法：docker compose exec api python /srv/seeds/seed_routes.py
改分级规则后：先跑 python3 pipeline/build.py 重新生成，再执行本脚本。
"""
import json
import re
import sys
from pathlib import Path

for cand in ("/srv/routes-data/routes.json",
             Path(__file__).resolve().parents[2] / "pipeline/out/routes.json"):
    if Path(cand).exists():
        SRC = Path(cand)
        break
else:
    raise SystemExit("找不到 routes.json，先在仓库根目录跑 python3 pipeline/build.py")

sys.path.insert(0, "/srv")
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402


def split_name(full: str):
    m = re.match(r"^([^（(]+)[（(](.+)[）)]$", full.strip())
    return (m.group(1).strip(), m.group(2).strip()) if m else (full.strip(), None)


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    n_seg = n_peak = 0
    with engine.begin() as c:
        uid = c.execute(text("""INSERT INTO users (wx_openid, nickname)
            VALUES ('demo_openid','阿甘') ON CONFLICT (wx_openid)
            DO UPDATE SET nickname = EXCLUDED.nickname RETURNING id""")).scalar()

        for slug, r in data.items():
            name, sub = split_name(r["name"])
            h = r.get("hardest") or {}
            rid = c.execute(text("""INSERT INTO routes
                (slug, name, sub, city, km, up, down, hardest_level, hours, kcal, est,
                 peak_count, path, profile, status)
                VALUES (:slug, :name, :sub, :city, :km, :up, :down, :hl, :hours, :kcal,
                        CAST(:est AS jsonb), :pc, CAST(:path AS jsonb), CAST(:prof AS jsonb),
                        'published')
                ON CONFLICT (slug) DO UPDATE SET
                  name = EXCLUDED.name, sub = EXCLUDED.sub, city = EXCLUDED.city,
                  km = EXCLUDED.km, up = EXCLUDED.up, down = EXCLUDED.down,
                  hardest_level = EXCLUDED.hardest_level, hours = EXCLUDED.hours,
                  kcal = EXCLUDED.kcal, est = EXCLUDED.est, peak_count = EXCLUDED.peak_count,
                  path = EXCLUDED.path, profile = EXCLUDED.profile, updated_at = now()
                RETURNING id"""),
                {"slug": slug, "name": name, "sub": sub, "city": r.get("city"),
                 "km": r["km"], "up": r["up"],
                 "down": r["down"], "hl": h.get("level", "mid"), "hours": r.get("hours"),
                 "kcal": r.get("kcal"), "est": json.dumps(r.get("est") or {}, ensure_ascii=False),
                 "pc": len(r["peaks"]), "path": json.dumps(r["path"]),
                 "prof": json.dumps(r["profile"])}).scalar()

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

        # 首次联调时创建示例点位；重复导入不清理既有点位或短链。
        first = next(iter(data.values()))
        pk = max(first["peaks"], key=lambda p: p["ele"])
        code = "QS-TEST01"
        pid = c.execute(text("""INSERT INTO points
            (code, type, name, route_id, index_in_route, total_in_route, level, altitude,
             geom, status)
            VALUES (:code, 'peak', :name, 1, 1, :total, :lv, :alt,
                    ST_SetSRID(ST_MakePoint(116.10, 40.05), 4326), 'published')
            ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
            RETURNING id"""),
            {"code": code, "name": "测试山顶", "total": len(first["peaks"]),
             "lv": first["hardest"]["level"], "alt": pk["ele"]}).scalar()
        c.execute(text("""INSERT INTO short_links (code, point_id) VALUES (:c, :p)
                        ON CONFLICT (code) DO NOTHING"""),
                  {"c": code, "p": pid})

    print(f"✓ {len(data)} 条线路 / {n_seg} 段 / {n_peak} 个山顶 / 1 个点位（{code}）")
    print(f"  演示用户 id={uid}")


if __name__ == "__main__":
    main()
