# -*- coding: utf-8 -*-
"""给还没有短链的已发布 V2 点位补分配短链（二维码载体）。"""
import os
import psycopg

DSN = os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://")

NEXT_CODE = """
select coalesce(max(case when code ~ '^BJ-[0-9]{4}$' then substring(code from 4)::int end), 1040) + 1
  from short_links
"""

with psycopg.connect(DSN, autocommit=False) as conn, conn.cursor() as cur:
    cur.execute("""select p.id, p.point_type, p.name, p.forward_order, p.elevation_m,
                          p.latitude, p.longitude, r.id
                     from route_points_v2 p join routes r on r.id = p.route_id
                    where p.review_status = 'published' and p.existing_point_id is null
                    order by r.slug, p.forward_order""")
    rows = cur.fetchall()
    print("待补短链点位:", len(rows))
    made = 0
    for pid, ptype, name, order, ele, lat, lng, route_id in rows:
        cur.execute(NEXT_CODE)
        code = "BJ-%04d" % cur.fetchone()[0]
        kind = ("peak" if ptype == "peak" else
                "trailhead" if ptype in ("start", "end") else "junction")
        cur.execute("""insert into points
            (code, type, name, route_id, index_in_route, total_in_route, level, altitude, geom, status)
            values (%s,%s,%s,%s,%s,0,'mid',%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), 'published')
            returning id""", (code, kind, name, route_id, order + 1, ele, lng, lat))
        new_id = cur.fetchone()[0]
        cur.execute("insert into short_links (code, point_id) values (%s,%s)", (code, new_id))
        cur.execute("update route_points_v2 set existing_point_id=%s where id=%s", (new_id, pid))
        made += 1
    conn.commit()
    cur.execute("""select count(*) from route_points_v2
                    where review_status='published' and existing_point_id is null""")
    print("补完后仍无短链:", cur.fetchone()[0])
    cur.execute(NEXT_CODE)
    print("下一个可用短链:", "BJ-%04d" % cur.fetchone()[0])
    cur.execute("select count(*) from short_links where code like 'BJ-%'")
    print("BJ 短链总数:", cur.fetchone()[0])
