"""到此一游 · API v1（W1 骨架 + W2 主链路）

W1 只做：健康检查、路书读取、点位读取。写路径（打卡/留言）在 W2 补全。
查询用 SQLAlchemy Core + 原生 SQL，ORM 模型等写路径复杂起来再引入。
"""
import os
from datetime import date

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://hikes:hikes@db:5432/hikes")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

app = FastAPI(title="到此一游 API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # 1.0 放开；上线前收敛到具体域名
    allow_methods=["*"],
    allow_headers=["*"],
)


def q(sql: str, **params):
    with engine.begin() as conn:
        return conn.execute(text(sql), params).mappings().all()


def q1(sql: str, **params):
    rows = q(sql, **params)
    return rows[0] if rows else None


@app.get("/health")
def health():
    """验收用：既要能连库，也要确认 PostGIS 装上了。"""
    row = q1("SELECT postgis_version() AS pgis, current_database() AS db")
    counts = q1("""SELECT
        (SELECT count(*) FROM routes)          AS routes,
        (SELECT count(*) FROM route_segments)  AS segments,
        (SELECT count(*) FROM route_peaks)     AS peaks,
        (SELECT count(*) FROM points)          AS points""")
    return {"ok": True, "postgis": row["pgis"], "db": row["db"], **dict(counts)}


# ---------------- 路书 ----------------

@app.get("/api/routes")
def list_routes(level: str | None = None, limit: int = 20):
    sql = """SELECT id, slug, name, sub, km, up, down, level, peak_count,
                    (SELECT count(*) FROM route_segments s WHERE s.route_id = r.id) AS segment_count,
                    (SELECT coalesce(sum(seq),0) FROM visits v
                       JOIN points p ON p.id = v.point_id WHERE p.route_id = r.id) AS visit_count
             FROM routes r WHERE status = 'published'"""
    if level:
        sql += " AND level = :level"
    sql += " ORDER BY id LIMIT :limit"
    rows = q(sql, level=level, limit=limit)
    return {"items": [dict(r) for r in rows], "nextCursor": None}


@app.get("/api/routes/{slug}")
def get_route(slug: str):
    r = q1("SELECT * FROM routes WHERE slug = :slug", slug=slug)
    if not r:
        raise HTTPException(404, detail={"error": {"code": "ROUTE_NOT_FOUND", "message": "线路不存在"}})
    segs = q("""SELECT no, from_km, to_km, km, rise, pct, level, kind, source, confirmed,
                       (SELECT count(*) FROM comments c WHERE c.point_id IS NULL) AS _x
                FROM route_segments WHERE route_id = :id ORDER BY no""", id=r["id"])
    peaks = q("SELECT idx, km, altitude, rise FROM route_peaks WHERE route_id = :id ORDER BY idx", id=r["id"])
    out = dict(r)
    out.pop("geom", None)
    out["segments"] = [{k: v for k, v in dict(s).items() if k != "_x"} for s in segs]
    out["peaks"] = [dict(p) for p in peaks]
    return out


# ---------------- 点位 ----------------

@app.get("/api/points/{code}")
def get_point(code: str):
    p = q1("""SELECT pt.*, r.name AS route_name FROM points pt
              LEFT JOIN routes r ON r.id = pt.route_id
              WHERE pt.code = :code""", code=code)
    if not p:
        raise HTTPException(404, detail={"error": {"code": "POINT_NOT_FOUND", "message": "点位不存在"}})
    top = q1("""SELECT c.id, c.text, c.like_count, c.bad_count, c.status, c.created_at,
                       u.nickname, (pt.maintainer_id = c.user_id) AS is_maintainer
                FROM comments c JOIN users u ON u.id = c.user_id
                JOIN points pt ON pt.id = c.point_id
                WHERE c.point_id = :pid AND c.status <> 'hidden'
                ORDER BY is_maintainer DESC, (c.like_count - c.bad_count) DESC, c.created_at DESC
                LIMIT 1""", pid=p["id"])
    cnt = q1("SELECT count(*) AS n FROM visits WHERE point_id = :pid", pid=p["id"])
    out = dict(p)
    out.pop("geom", None)
    out["visitCount"] = cnt["n"]
    out["topComment"] = dict(top) if top else None
    return out


class VisitIn(BaseModel):
    source: str = Field(default="scan", pattern="^(scan|nearby|manual)$")


@app.post("/api/points/{point_id}/visit")
def do_visit(point_id: int, body: VisitIn, x_user_id: int = Header(default=0, alias="X-User-Id")):
    """打卡。一天一次的去重靠数据库唯一约束，不靠代码判断。
    W2 接微信登录后，user_id 从 JWT 取；现在先用 X-User-Id 头方便联调。"""
    if not x_user_id:
        raise HTTPException(401, detail={"error": {"code": "UNAUTHORIZED", "message": "未登录"}})
    p = q1("SELECT id FROM points WHERE id = :id", id=point_id)
    if not p:
        raise HTTPException(404, detail={"error": {"code": "POINT_NOT_FOUND", "message": "点位不存在"}})
    with engine.begin() as conn:
        row = conn.execute(text("""INSERT INTO visits (user_id, point_id, seq, visit_date, source)
            VALUES (:uid, :pid,
                    (SELECT coalesce(max(seq),0)+1 FROM visits WHERE point_id = :pid),
                    CURRENT_DATE, :src)
            ON CONFLICT (user_id, point_id, visit_date) DO NOTHING
            RETURNING seq"""), {"uid": x_user_id, "pid": point_id, "src": body.source}).first()
        if row is None:     # 今天已经打过，返回已有记录
            row = conn.execute(text("""SELECT seq FROM visits
                WHERE user_id=:uid AND point_id=:pid AND visit_date=CURRENT_DATE"""),
                {"uid": x_user_id, "pid": point_id}).first()
            is_first = False
        else:
            is_first = True
    my = q1("""SELECT count(*) AS n FROM visits WHERE user_id=:uid AND point_id=:pid""",
            uid=x_user_id, pid=point_id)
    return {"seq": row[0], "isFirstVisit": is_first, "myVisitCount": my["n"],
            "message": f"你是第 {row[0]} 位在这里留下痕迹的人"}
