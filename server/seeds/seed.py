"""种子数据：把 app/js/route-sanfeng.js 里已算好的分级结果导进库。
等 pipeline 工程化之后，这里改成调用 pipeline/build.py，不再读前端产物。

用法：docker compose exec api python /srv/seeds/seed.py
"""
import json
import re
import sys
from pathlib import Path

for cand in ("/srv/route-data/route-sanfeng.js",
             Path(__file__).resolve().parents[2] / "app/js/route-sanfeng.js"):
    if Path(cand).exists():
        SRC = Path(cand)
        break
else:
    raise SystemExit("找不到 route-sanfeng.js")

sys.path.insert(0, "/srv")
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402


def load():
    raw = SRC.read_text(encoding="utf-8")
    m = re.search(r"window\.SANFENG\s*=\s*(\{.*\})\s*;", raw, re.S)
    if not m:
        raise SystemExit(f"解析失败：{SRC}")
    return json.loads(m.group(1))


def main():
    d = load()
    with engine.begin() as c:
        c.execute(text("TRUNCATE route_peaks, route_segments, comments, comment_votes, "
                       "visits, scans, short_links, points, routes RESTART IDENTITY CASCADE"))
        rid = c.execute(text("""INSERT INTO routes
            (slug, name, sub, km, up, down, level, peak_count, path, profile, status)
            VALUES ('sanfeng', :name, :sub, :km, :up, :down, :level, :pc,
                    CAST(:path AS jsonb), CAST(:prof AS jsonb), 'published')
            RETURNING id"""),
            {"name": d["name"], "sub": d.get("sub"), "km": d["km"], "up": d["up"], "down": d["dn"],
             "level": "hard", "pc": len(d["peaks"]),
             "path": json.dumps(d["path"]), "prof": json.dumps(d["prof"])}).scalar()

        for i, s in enumerate(d["segs"], start=1):
            c.execute(text("""INSERT INTO route_segments
                (route_id, no, from_km, to_km, km, rise, pct, level, kind, source, confirmed)
                VALUES (:rid, :no, :f, :t, :km, :rise, :pct, :level, :kind, 'auto', false)"""),
                {"rid": rid, "no": i, "f": s["from"], "t": s["to"], "km": s["km"],
                 "rise": s["rise"], "pct": s["pct"], "level": s["level"], "kind": s["kind"]})

        for i, p in enumerate(d["peaks"]):
            c.execute(text("""INSERT INTO route_peaks (route_id, idx, km, altitude, rise)
                VALUES (:rid, :i, :km, :alt, :rise)"""),
                {"rid": rid, "i": i, "km": p["km"], "alt": p["ele"],
                 "rise": d["segs"][i]["rise"] if i < len(d["segs"]) else 0})

        # 一个示例点位 + 短链，供 W2 扫码联调
        pid = c.execute(text("""INSERT INTO points
            (code, type, name, route_id, index_in_route, total_in_route, level, altitude, geom, status)
            VALUES ('QS-P1092', 'peak', '鹫峰顶', :rid, 1, 5, 'hard', 1092,
                    ST_SetSRID(ST_MakePoint(116.10, 40.05), 4326), 'published')
            RETURNING id"""), {"rid": rid}).scalar()
        c.execute(text("INSERT INTO short_links (code, point_id) VALUES ('QS-P1092', :pid)"), {"pid": pid})

    print(f"✓ 线路 {d['name']}：{len(d['segs'])} 段 / {len(d['peaks'])} 个山顶 / 1 个点位")
    print("  验证：curl localhost:8000/health")


if __name__ == "__main__":
    main()
