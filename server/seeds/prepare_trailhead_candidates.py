"""从线路轨迹起点准备山脚打卡候选。

只处理已有 type=trailhead 且没有 geom 的点位。轨迹起点只是**候选**：
脚本会把它写成 status='draft'，等维护人到现场核对名称和坐标后再发布。
没有关联山头的线路也会生成候选，但会标 needs_mountain，只有平台地理审核员能处理。

默认 dry-run，确认数量后加 --apply：

  DATABASE_URL=... python /srv/seeds/prepare_trailhead_candidates.py
  DATABASE_URL=... python /srv/seeds/prepare_trailhead_candidates.py --apply
  DATABASE_URL=... python /srv/seeds/prepare_trailhead_candidates.py --route sanfeng --apply
"""
from __future__ import annotations

import argparse
import json
import os

from sqlalchemy import create_engine, text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--route", help="只处理某条线路的 slug")
    args = parser.parse_args()

    engine = create_engine(
        os.getenv("DATABASE_URL", "postgresql+psycopg://hikes:hikes@db:5432/hikes"),
        pool_pre_ping=True,
    )
    route_filter = "AND r.slug = :route" if args.route else ""
    with engine.begin() as conn:
        rows = conn.execute(text(f"""
            SELECT p.id, p.code, p.name, p.route_id, r.slug, r.name AS route_name,
                   ST_Y(ST_StartPoint(r.geom)) AS lat,
                   ST_X(ST_StartPoint(r.geom)) AS lng,
                   (SELECT rp.mountain_id
                      FROM route_peaks rp
                     WHERE rp.route_id = r.id AND rp.mountain_id IS NOT NULL
                     ORDER BY coalesce(rp.elevation_m, rp.altitude) DESC NULLS LAST,
                              rp.idx
                     LIMIT 1) AS mountain_id
              FROM points p
              JOIN routes r ON r.id = p.route_id
             WHERE p.type = 'trailhead'
               AND p.geom IS NULL
               AND r.geom IS NOT NULL
               {route_filter}
             ORDER BY p.id
             LIMIT :limit
        """), {"limit": max(args.limit, 1), "route": args.route}).mappings().all()

        print("trailhead candidates:", len(rows),
              "with mountain:", sum(1 for r in rows if r["mountain_id"] is not None),
              "without mountain:", sum(1 for r in rows if r["mountain_id"] is None))
        for r in rows[:8]:
            print(" ", r["code"], r["route_name"], r["lat"], r["lng"],
                  "mountain=" + str(r["mountain_id"]))
        if not args.apply:
            print("dry-run; add --apply to create draft candidates")
            return

        updated = 0
        for r in rows:
            marker = json.dumps({
                "candidate_source": "route_start",
                "candidate_route": r["slug"],
                "review_required": True,
                "trailhead_review": "draft",
                "needs_mountain": r["mountain_id"] is None,
            }, ensure_ascii=False)
            conn.execute(text("""
                UPDATE points
                   SET geom = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                       name = coalesce(nullif(name, ''), :name),
                       mountain_id = coalesce(mountain_id, :mountain_id),
                       status = 'draft',
                       guide = coalesce(guide, '{}'::jsonb) || CAST(:marker AS jsonb),
                       version = version + 1
                 WHERE id = :id
                   AND type = 'trailhead'
                   AND geom IS NULL
            """), {
                "id": r["id"], "lat": r["lat"], "lng": r["lng"],
                "name": (r["route_name"] or r["code"]) + " · 山脚候选",
                "mountain_id": r["mountain_id"], "marker": marker,
            })
            updated += 1
        print("created draft candidates:", updated)


if __name__ == "__main__":
    main()
