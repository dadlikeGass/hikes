# -*- coding: utf-8 -*-
"""V2 全量生成器 v2：把管线分段翻译成 V2 四表 + 发布批次 + 短链/二维码。

要点：
1. 边界首尾吸附到 0 与线路全长（原来 69 条因尾差 >25m 过不了校验）
2. 爬升/下降/距离按线路高程剖面重算，并用 pipeline.difficulty_v2 的 _score/grade_for_score 定级
   —— 与管线口径完全一致
3. 发布走真实分配逻辑：每个 V2 点位建 points + short_links（短链即二维码承载）
4. 已有人工审核版（三峰）不覆盖
"""
import argparse
import json
import pathlib
import sys

import psycopg

PIPE = pathlib.Path("/root/hikes_backend/hikes/pipeline")
sys.path.insert(0, str(PIPE))
from difficulty_v2 import MODEL_VERSION, _score, grade_for_score  # noqa: E402

CAND = PIPE / "out" / "difficulty_v2" / "all.candidate.json"


def seg_index(profile_len, frac):
    return max(0, min(profile_len - 1, round(frac * (profile_len - 1))))


def bump(profile, i0, i1, reverse=False):
    """按剖面走一遍，返回 (爬升, 下降)。reverse=True 表示反向走。"""
    idx = list(range(i0, i1 + 1))
    if reverse:
        idx.reverse()
    up = down = 0.0
    for a, b in zip(idx, idx[1:]):
        d = profile[b] - profile[a]
        if d > 0:
            up += d
        else:
            down -= d
    return round(up), round(down)


def classify(profile, i, w=2):
    n = len(profile)
    left = profile[max(0, i - w):i] or [profile[i]]
    right = profile[i + 1:min(n, i + 1 + w)] or [profile[i]]
    here = profile[i]
    if here >= max(left) + 15 and here >= max(right) + 15:
        return "peak"
    if here <= min(left) - 15 and here <= min(right) - 15:
        return "valley"
    return "waist"


def allocate_code(cur):
    cur.execute("""select coalesce(max(
        CASE WHEN code ~ '^BJ-[0-9]{4}$' THEN substring(code from 4)::int END),1040)+1
        from short_links""")
    return "BJ-%04d" % cur.fetchone()[0]


def generate_one(cur, slug, pkg):
    cur.execute("select id, km, elevation_m from routes where slug=%s", (slug,))
    row = cur.fetchone()
    if not row:
        return "skip: 无此线路"
    route_id, route_km, profile = row
    route_km = float(route_km)
    profile = [float(x) for x in (profile or [])]
    if len(profile) < 12:
        return "skip: 高程剖面不足"

    cur.execute("""select 1 from route_difficulty_publications p
                    join routes r on r.id=p.route_id
                   where r.slug=%s and p.status='published'
                     and p.segmentation_version like '%%reviewed%%'""", (slug,))
    if cur.fetchone():
        return "skip: 已有人工审核版，保留"

    segs = sorted(pkg["segments"], key=lambda s: s["forwardOrder"])
    cuts = [round(float(s["fromKm"]), 3) for s in segs] + [round(float(segs[-1]["toKm"]), 3)]
    cuts = [max(0.0, min(route_km, c)) for c in cuts]
    cuts[0] = 0.0
    cuts[-1] = route_km
    uniq = []
    for c in cuts:
        if not uniq or abs(c - uniq[-1]) > 0.002:
            uniq.append(c)
    cuts = uniq
    if len(cuts) < 2:
        return "skip: 边界不足"

    # 清理旧机器数据
    cur.execute("delete from route_difficulty_publications where route_id=%s", (route_id,))
    cur.execute("""delete from segment_difficulty_results where segment_id in
                     (select id from route_segments_v2 where route_id=%s)""", (route_id,))
    cur.execute("delete from route_segments_v2 where route_id=%s", (route_id,))
    cur.execute("delete from route_points_v2 where route_id=%s", (route_id,))

    segv = pkg["segmentationVersion"] or "terrain_segment_v1"
    model = pkg["modelVersion"] or MODEL_VERSION

    point_ids = {}
    for order, km in enumerate(cuts):
        frac = km / route_km
        i = seg_index(len(profile), frac)
        ptype = "start" if order == 0 else ("end" if order == len(cuts) - 1 else classify(profile, i))
        cur.execute("""insert into route_points_v2
            (stable_key, route_id, segmentation_version, forward_m, forward_order, point_type,
             name, latitude, longitude, elevation_m, review_status, source_payload)
            SELECT %s,%s,%s,%s,%s,%s,NULL,
                   ST_Y(ST_LineInterpolatePoint(geom, %s)), ST_X(ST_LineInterpolatePoint(geom, %s)),
                   %s,'candidate','{"source":"terrain_segment_v1"}'::jsonb
              FROM routes WHERE id=%s RETURNING id""",
            (f"{slug}:v2:{order}", route_id, segv, int(round(km * 1000)), order, ptype,
             frac, frac, round(profile[i]), route_id))
        point_ids[order] = cur.fetchone()[0]

    seg_rows = []
    for n, s in enumerate(segs):
        from_km, to_km = cuts[n], cuts[n + 1]
        i0, i1 = seg_index(len(profile), from_km / route_km), seg_index(len(profile), to_km / route_km)
        dist_km = round(to_km - from_km, 3)
        if dist_km <= 0.002:
            return "skip: 零长度分段"
        fwd_up, fwd_down = bump(profile, i0, i1, False)
        rev_up, rev_down = bump(profile, i0, i1, True)
        cur.execute("""insert into route_segments_v2
            (stable_key, route_id, segmentation_version, from_m, to_m, forward_order, reverse_order,
             start_point_id, end_point_id, boundary_start_type, boundary_end_type, status)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'reviewed') returning id""",
            (f"{slug}:segv2:{n + 1}", route_id, segv, int(round(from_km * 1000)), int(round(to_km * 1000)),
             n + 1, len(segs) - n, point_ids[n], point_ids[n + 1],
             ("start" if n == 0 else "mid"), ("end" if n == len(segs) - 1 else "mid")))
        seg_id = cur.fetchone()[0]
        seg_rows.append((seg_id, dist_km, (fwd_up, fwd_down), (rev_up, rev_down)))

    result_ids = []
    for seg_id, dist_km, fwd, rev in seg_rows:
        for direction, (up, down) in (("forward", fwd), ("reverse", rev)):
            score = _score(up, down, dist_km)
            grade = grade_for_score(score)
            cur.execute("""insert into segment_difficulty_results
                (segment_id, travel_direction, model_version, distance_m, ascent_m, descent_m,
                 internal_score, base_grade, terrain_shift, published_grade, terrain_tags,
                 payload_hash, status)
                values (%s,%s,%s,%s,%s,%s,%s,%s,0,%s,'[]'::jsonb,%s,'candidate') returning id""",
                (seg_id, direction, model, int(round(dist_km * 1000)), up, down, round(score, 6),
                 grade["key"], grade["key"], f"{seg_id}-{direction}"))
            result_ids.append(cur.fetchone()[0])

    cur.execute("""select coalesce(max(publication_version),0)+1 from route_difficulty_publications
                    where route_id=%s""", (route_id,))
    version = cur.fetchone()[0]
    cur.execute("""insert into route_difficulty_publications
        (route_id, segmentation_version, model_version, grade_version, publication_version, status)
        values (%s,%s,%s,'grade_v1',%s,'draft') returning id""",
        (route_id, segv, model, version))
    pub = cur.fetchone()[0]
    for order in range(len(cuts)):
        cur.execute("""insert into route_point_publication_items (publication_id, route_point_id, display_order)
                       values (%s,%s,%s)""", (pub, point_ids[order], order))
    for rid in result_ids:
        cur.execute("""insert into route_difficulty_publication_items (publication_id, difficulty_result_id)
                       values (%s,%s)""", (pub, rid))
    cur.execute("select validate_route_publication(%s)", (pub,))

    # ---- 真实发布：每个 V2 点位分配 points + short_links（二维码就挂在这条短链上）----
    cur.execute("select pg_advisory_xact_lock(hashtext('route-point-code'))")
    cur.execute("""select rp.id, rp.existing_point_id, rp.point_type, rp.name, rp.forward_order,
                           rp.elevation_m, rp.latitude, rp.longitude
                      from route_point_publication_items pi
                      join route_points_v2 rp on rp.id = pi.route_point_id
                     where pi.publication_id=%s order by pi.display_order""", (pub,))
    allocated = 0
    for (pt_id, pt_existing, pt_type, pt_name, pt_order, pt_ele, pt_lat, pt_lng) in cur.fetchall():
        class _Pt(dict):
            pass
        if pt_existing is None:
            code = allocate_code(cur)
            ptype = ("peak" if pt_type == "peak" else
                     "trailhead" if pt_type in ("start", "end") else "junction")
            cur.execute("""insert into points
                (code,type,name,route_id,index_in_route,total_in_route,level,altitude,geom,status)
                values (%s,%s,%s,%s,%s,%s,'mid',%s,
                        ST_SetSRID(ST_MakePoint(%s,%s),4326),'published') returning id""",
                (code, ptype, pt_name or None, route_id, pt_order + 1,
                 len(cuts), pt_ele, pt_lng, pt_lat))
            pid = cur.fetchone()[0]
            cur.execute("insert into short_links (code, point_id) values (%s,%s)", (code, pid))
            cur.execute("update route_points_v2 set existing_point_id=%s where id=%s", (pid, pt_id))
            allocated += 1

    cur.execute("""update route_points_v2 set review_status='published'
                    where id in (select route_point_id from route_point_publication_items
                                  where publication_id=%s)""", (pub,))
    cur.execute("""update route_segments_v2 set status='published'
                    where id in (select d.segment_id from route_difficulty_publication_items i
                                 join segment_difficulty_results d on d.id=i.difficulty_result_id
                                  where i.publication_id=%s)""", (pub,))
    cur.execute("""update segment_difficulty_results set status='published'
                    where id in (select difficulty_result_id from route_difficulty_publication_items
                                  where publication_id=%s)""", (pub,))
    cur.execute("""update route_difficulty_publications
                    set status='published', published_at=now() where id=%s""", (pub,))
    return f"ok: {len(cuts)} 点 / {len(seg_rows)} 段 / 新分配短链 {allocated}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", required=True)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    data = json.loads(CAND.read_text(encoding="utf-8"))
    slugs = args.only.split(",") if args.only else list(data)
    stats = {"ok": 0, "skip": 0, "fail": 0}
    fails = []
    with psycopg.connect(args.dsn, autocommit=False) as conn:
        for slug in slugs:
            with conn.cursor() as cur:
                try:
                    msg = generate_one(cur, slug, data[slug])
                    conn.commit()
                except Exception as exc:  # noqa: BLE001
                    conn.rollback()
                    msg = "FAIL: " + str(exc).splitlines()[0][:110]
                    fails.append((slug, msg))
            stats["ok" if msg.startswith("ok") else "skip" if msg.startswith("skip") else "fail"] += 1
            print(f"  {slug:34} {msg}")
    print("\n汇总:", stats)
    for slug, msg in fails[:6]:
        print("  失败:", slug, msg)


main()
