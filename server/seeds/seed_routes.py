"""把 pipeline/build.py 的产物导入数据库：routes + route_segments + route_peaks。

三个来源共用这一个脚本（过去是 seed_routes / seed_routes_cn / seed_race_routes
三份逐字重复的 upsert）；类型（徒步 / 赛事）由产物里的 `kind` 字段决定。

用法（容器里）：
  docker compose exec api python /srv/seeds/seed_routes.py --file /srv/routes-data/routes.json
  docker compose exec api python /srv/seeds/seed_routes.py --file /srv/routes-data/routes_cn.json
  docker compose exec api python /srv/seeds/seed_routes.py --file /srv/routes-data/race_routes.json
  docker compose exec api python /srv/seeds/seed_routes.py --all          # 三份按顺序全导
  docker compose exec api python /srv/seeds/seed_routes.py --all --demo-point

可重复执行、不清库：按 slug upsert，只动自己这批；人工确认过的段难度和峰名
（`confirmed` / `name_status = 'confirmed'`）不会被覆盖。改分级规则后先跑
`python3 pipeline/build.py` 重新生成产物，再执行本脚本。

`--demo-point` 只给北京那批补 QS-TEST01 演示扫码点（首页"扫码打卡"和二维码
链路用的就是它，不是遗留数据，所以留着，但默认不建）。
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FILES = {
    "routes.json": "北京山野徒步/越野",
    "routes_cn.json": "全国区域热门路线",
    "race_routes.json": "越野赛事赛道",
}

sys.path.insert(0, "/srv")
for cand in ("/srv", str(ROOT / "server")):
    if Path(cand, "app", "main.py").exists():
        sys.path.insert(0, cand)
        break
from app.main import engine  # noqa: E402
from sqlalchemy import text  # noqa: E402

UPSERT_ROUTE = """
INSERT INTO routes
  (slug, name, sub, city, km, up, down, hardest_level, hours, kcal, est, peak_count,
   path, profile, elevation_m, geom, status, kind, source, year,
   race_event, race_category, race_place, race_source)
VALUES
  (:slug, :name, :sub, :city, :km, :up, :down, :hl, :hours, :kcal,
   CAST(:est AS jsonb), :pc, CAST(:path AS jsonb), CAST(:prof AS jsonb), CAST(:elev AS jsonb),
   CASE WHEN CAST(:geo AS text) IS NULL THEN NULL
        ELSE ST_SetSRID(ST_GeomFromGeoJSON(CAST(:geo AS text)), 4326) END,
   'published', :kind, :source, :year, :event, :category, :place, :race_source)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, sub = EXCLUDED.sub, city = EXCLUDED.city,
  km = EXCLUDED.km, up = EXCLUDED.up, down = EXCLUDED.down,
  hardest_level = EXCLUDED.hardest_level, hours = EXCLUDED.hours, kcal = EXCLUDED.kcal,
  est = EXCLUDED.est, peak_count = EXCLUDED.peak_count,
  path = EXCLUDED.path, profile = EXCLUDED.profile, elevation_m = EXCLUDED.elevation_m,
  geom = EXCLUDED.geom, status = EXCLUDED.status, kind = EXCLUDED.kind,
  source = EXCLUDED.source, year = EXCLUDED.year,
  race_event = EXCLUDED.race_event, race_category = EXCLUDED.race_category,
  race_place = EXCLUDED.race_place, race_source = EXCLUDED.race_source,
  updated_at = now()
RETURNING id
"""

# 段难度规则见 migration 0008 与 pipeline/build.py：净下坡段 level 为 NULL，
# 定级用 max_rise_m（段内最大连续爬升）。
UPSERT_SEGMENT = """
INSERT INTO route_segments
  (route_id, no, from_km, to_km, km, rise, pct, level, kind, source, confirmed,
   difficulty_applicable, up_m, down_m, max_rise_m, max_drop_m)
VALUES (:rid, :no, :f, :t, :km, :rise, :pct, :lv, :kind, 'auto', false, :applicable,
        :up_m, :down_m, :rise_m, :drop)
ON CONFLICT (route_id, no) DO UPDATE SET
  from_km = EXCLUDED.from_km, to_km = EXCLUDED.to_km,
  km = EXCLUDED.km, rise = EXCLUDED.rise, pct = EXCLUDED.pct,
  kind = EXCLUDED.kind, difficulty_applicable = EXCLUDED.difficulty_applicable,
  up_m = EXCLUDED.up_m, down_m = EXCLUDED.down_m,
  max_rise_m = EXCLUDED.max_rise_m, max_drop_m = EXCLUDED.max_drop_m,
  level = CASE WHEN route_segments.confirmed THEN route_segments.level
               ELSE EXCLUDED.level END
"""

UPSERT_PEAK = """
INSERT INTO route_peaks
  (route_id, idx, km, altitude, rise, lat, lng, geom, name)
VALUES (:rid, :i, :km, :alt, :rise, :lat, :lng,
        CASE WHEN :lat IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) END,
        :name)
ON CONFLICT (route_id, idx) DO UPDATE SET
  km = EXCLUDED.km, altitude = EXCLUDED.altitude, rise = EXCLUDED.rise,
  lat = EXCLUDED.lat, lng = EXCLUDED.lng, geom = EXCLUDED.geom,
  name = CASE WHEN route_peaks.name_status = 'confirmed' THEN route_peaks.name
              ELSE EXCLUDED.name END
"""


def resolve(arg: str) -> Path:
    for cand in (arg, f"/srv/routes-data/{Path(arg).name}",
                 ROOT / "pipeline" / "out" / Path(arg).name):
        if Path(cand).is_file():
            return Path(cand)
    raise SystemExit(f"找不到 {arg}，先在仓库根目录跑 python3 pipeline/build.py")


def load(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"{path} 不是 build.py 的产物（应为 slug → 路线 的对象）")
    return data


def geo_json(r):
    coords = r.get("coordinates") or []
    if len(coords) < 2:
        return None
    return json.dumps({"type": "LineString", "coordinates": [[p[1], p[0]] for p in coords]})


def import_file(c, src: Path, demo_point=False):
    data = load(src)
    n_seg = n_peak = n_unrated = n_pruned_seg = n_pruned_peak = 0
    for slug, r in data.items():
        h = r.get("hardest") or {}
        rid = c.execute(text(UPSERT_ROUTE), {
            "slug": slug, "name": r["name"], "sub": r.get("sub"), "city": r.get("city"),
            "km": r["km"], "up": r["up"], "down": r["down"],
            # 没有可定级爬升的线路就是未评级，不用 'mid' 顶上。
            "hl": h.get("level"), "hours": r.get("hours"), "kcal": r.get("kcal"),
            "est": json.dumps(r.get("est") or {}, ensure_ascii=False),
            "elev": json.dumps(r.get("elevation_m", [])),
            "pc": len(r["peaks"]), "path": json.dumps(r["path"]),
            "prof": json.dumps(r["profile"]),
            "kind": r.get("kind") or "hike", "source": r.get("source"),
            "year": r.get("year"), "event": r.get("event"),
            "category": r.get("category"), "place": r.get("place"),
            "race_source": r.get("source") if r.get("kind") == "race" else None,
            "geo": geo_json(r),
        }).scalar()

        for s in r["segments"]:
            applicable = bool(s.get("difficulty_applicable"))
            c.execute(text(UPSERT_SEGMENT), {
                "rid": rid, "no": s["no"], "f": s["from"], "t": s["to"], "km": s["km"],
                "rise": s["rise"], "pct": s["pct"],
                "lv": s["level"] if applicable else None, "kind": s["kind"],
                "applicable": applicable, "up_m": s.get("up_m", 0),
                "down_m": s.get("down_m", 0), "rise_m": s.get("max_rise_m", 0),
                "drop": s.get("max_drop_m", 0)})
            n_seg += 1
            n_unrated += 0 if applicable else 1

        # 切点或算法变了会让分段数变少，按 (route_id, no) upsert 会留下旧行。
        # 只清自己的自动行：人工确认过的段（confirmed / source='manual'）留着，
        # 那是人的结论，宁可留着待核，也不跟着算法一起消失。
        pruned_seg = c.execute(text("""
            DELETE FROM route_segments
             WHERE route_id = :rid AND no > :n
               AND source = 'auto' AND NOT confirmed
        """), {"rid": rid, "n": len(r["segments"])}).rowcount
        n_pruned_seg += max(0, pruned_seg or 0)

        for i, p in enumerate(r["peaks"]):
            prev = r["peaks"][i - 1]["ele"] if i else None
            c.execute(text(UPSERT_PEAK), {
                "rid": rid, "i": i, "km": p["km"], "alt": p["ele"],
                "rise": round(p["ele"] - prev) if prev else round(p["rel"]),
                "lat": p.get("lat"), "lng": p.get("lng"), "name": p.get("name")})
            n_peak += 1
        pruned_peak = c.execute(text("""
            DELETE FROM route_peaks
             WHERE route_id = :rid AND idx >= :n AND name_status <> 'confirmed'
        """), {"rid": rid, "n": len(r["peaks"])}).rowcount
        n_pruned_peak += max(0, pruned_peak or 0)

    if demo_point:
        # 首页"扫码打卡"、二维码与短链验收都用这个点位，保留但只在需要时创建。
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
             "lv": (first["hardest"] or {}).get("level"), "alt": pk["ele"]}).scalar()
        c.execute(text("""INSERT INTO short_links (code, point_id) VALUES (:c, :p)
                        ON CONFLICT (code) DO NOTHING"""), {"c": code, "p": pid})

    kinds = sorted({(r.get("kind") or "hike") for r in data.values()})
    extra = ""
    if n_pruned_seg or n_pruned_peak:
        extra = f"；清理旧算法的残留：{n_pruned_seg} 段 / {n_pruned_peak} 个山顶"
    print(f"✓ {src.name}：{len(data)} 条路线（{'/'.join(kinds)}）/ {n_seg} 段"
          f"（其中 {n_unrated} 段不评级）/ {n_peak} 个山顶{extra}")
    return len(data)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", action="append", default=[],
                    help="要导入的产物文件（可重复；默认 pipeline/out/routes.json）")
    ap.add_argument("--all", action="store_true", help="按顺序导入三个来源的产物")
    ap.add_argument("--demo-point", action="store_true",
                    help="只在导入北京那批时创建 QS-TEST01 演示扫码点")
    args = ap.parse_args(argv)

    if args.all:
        targets = [resolve(n) for n in DEFAULT_FILES]
    else:
        targets = [resolve(a) for a in (args.file or ["routes.json"])]

    total = 0
    with engine.begin() as c:
        for src in targets:
            total += import_file(c, src,
                                 demo_point=args.demo_point and src.name == "routes.json")
    print(f"完成：{total} 条路线，来源 {', '.join(t.name for t in targets)}")


if __name__ == "__main__":
    main()
