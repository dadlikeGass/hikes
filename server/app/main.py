"""到此一游 · API v1

实现在 docs/API.md 里定义的契约。全部返回体声明 response_model，错误响应也列出，
否则 /docs 里响应是空的，前端没法照着联调。
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://hikes:hikes@db:5432/hikes")
JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")
JWT_ALG = "HS256"
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

app = FastAPI(title="到此一游 API", version="1.0",
              description="契约见仓库 docs/API.md。错误响应统一为 "
                          "error.code / error.message。")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


# ==================== 基础设施 ====================

def q(sql: str, **params):
    with engine.begin() as conn:
        return conn.execute(text(sql), params).mappings().all()


def q1(sql: str, **params):
    rows = q(sql, **params)
    return rows[0] if rows else None


def err(status: int, code: str, message: str):
    raise HTTPException(status, detail={"error": {"code": code, "message": message}})


def make_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode({"sub": str(user_id), "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)


def require_user(authorization: str | None = Header(default=None)) -> int:
    """按契约 docs/API.md：Authorization: Bearer <jwt>。"""
    if not authorization or not authorization.lower().startswith("bearer "):
        err(401, "UNAUTHORIZED", "未登录")
    try:
        payload = jwt.decode(authorization.split(" ", 1)[1], JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        err(401, "TOKEN_EXPIRED", "登录已过期，请重新进入")
    except Exception:
        err(401, "TOKEN_INVALID", "登录凭证无效")
    return int(payload["sub"])


ERR_401 = {401: {"description": "未登录 / token 无效"}}
ERR_404 = {404: {"description": "资源不存在"}}


# ==================== 响应模型 ====================

class HealthOut(BaseModel):
    ok: bool
    postgis: str
    db: str
    routes: int
    segments: int
    peaks: int
    points: int


class RouteBrief(BaseModel):
    id: int
    slug: str
    name: str
    sub: str | None = None
    km: float
    up: int
    down: int
    level: Literal["easy", "mid", "hard", "hidden"]
    peak_count: int
    segment_count: int
    visit_count: int


class RouteListOut(BaseModel):
    items: list[RouteBrief]
    nextCursor: str | None = None


class SegmentOut(BaseModel):
    no: int
    from_km: float
    to_km: float
    km: float
    rise: int
    pct: int
    level: Literal["easy", "mid", "hard", "hidden"]
    kind: Literal["climb", "desc", "flat"]
    source: Literal["auto", "manual"]
    confirmed: bool


class PeakOut(BaseModel):
    idx: int
    km: float
    altitude: int
    rise: int


class RouteDetail(BaseModel):
    id: int
    slug: str
    name: str
    sub: str | None = None
    km: float
    up: int
    down: int
    level: Literal["easy", "mid", "hard", "hidden"]
    peak_count: int
    path: list[list[float]] = Field(description="归一化 0-1 坐标，前端直接画 SVG")
    profile: list[float] = Field(description="归一化海拔剖面")
    segments: list[SegmentOut]
    peaks: list[PeakOut]


class CommentOut(BaseModel):
    id: int
    text: str
    nickname: str | None = None
    is_maintainer: bool
    like_count: int
    bad_count: int
    status: Literal["normal", "flagged", "hidden"]
    created_at: datetime


class PointDetail(BaseModel):
    id: int
    code: str
    type: Literal["peak", "junction", "trailhead"]
    name: str
    route_id: int | None = None
    route_name: str | None = None
    index_in_route: int | None = None
    total_in_route: int | None = None
    level: Literal["easy", "mid", "hard", "hidden"]
    altitude: int | None = None
    guide: dict[str, Any] | None = None
    status: Literal["draft", "published"]
    version: int
    visitCount: int
    topComment: CommentOut | None = None


class VisitIn(BaseModel):
    source: Literal["scan", "nearby", "manual"] = "scan"


class VisitOut(BaseModel):
    seq: int = Field(description="你是第 N 位")
    isFirstVisit: bool = Field(description="今天是否首次打卡；同日重复请求为 false")
    myVisitCount: int
    message: str


class TokenOut(BaseModel):
    token: str
    tokenType: str = "Bearer"
    userId: int


# ==================== 认证 ====================

@app.post("/api/auth/dev-login", response_model=TokenOut, tags=["认证"],
          summary="开发用登录（正式登录走 /api/auth/wechat）")
def dev_login(user_id: int = 1):
    """只在 ALLOW_DEV_LOGIN=1 时开放。生产环境返回 404。"""
    if os.getenv("ALLOW_DEV_LOGIN") != "1":
        err(404, "NOT_FOUND", "未开放")
    return TokenOut(token=make_token(user_id), userId=user_id)


# ==================== 健康检查 ====================

@app.get("/health", response_model=HealthOut, tags=["系统"])
def health():
    row = q1("SELECT postgis_version() AS pgis, current_database() AS db")
    counts = q1("""SELECT
        (SELECT count(*) FROM routes)          AS routes,
        (SELECT count(*) FROM route_segments)  AS segments,
        (SELECT count(*) FROM route_peaks)     AS peaks,
        (SELECT count(*) FROM points)          AS points""")
    return HealthOut(ok=True, postgis=row["pgis"], db=row["db"], **dict(counts))


# ==================== 路书 ====================

@app.get("/api/routes", response_model=RouteListOut, tags=["路书"])
def list_routes(level: str | None = None, limit: int = 20):
    sql = """SELECT id, slug, name, sub, km, up, down, level, peak_count,
                    (SELECT count(*) FROM route_segments s WHERE s.route_id = r.id) AS segment_count,
                    (SELECT coalesce(sum(seq),0) FROM visits v
                       JOIN points p ON p.id = v.point_id WHERE p.route_id = r.id) AS visit_count
             FROM routes r WHERE status = 'published'"""
    if level:
        sql += " AND level = :level"
    sql += " ORDER BY id LIMIT :limit"
    return RouteListOut(items=[dict(r) for r in q(sql, level=level, limit=limit)],
                        nextCursor=None)


@app.get("/api/routes/{slug}", response_model=RouteDetail, tags=["路书"], responses=ERR_404)
def get_route(slug: str):
    r = q1("SELECT * FROM routes WHERE slug = :slug", slug=slug)
    if not r:
        err(404, "ROUTE_NOT_FOUND", "线路不存在")
    segs = q("""SELECT no, from_km, to_km, km, rise, pct, level, kind, source, confirmed
                FROM route_segments WHERE route_id = :id ORDER BY no""", id=r["id"])
    peaks = q("SELECT idx, km, altitude, rise FROM route_peaks WHERE route_id = :id ORDER BY idx",
              id=r["id"])
    d = dict(r)
    keys = ("id", "slug", "name", "sub", "km", "up", "down", "level", "peak_count",
            "path", "profile")
    return RouteDetail(**{k: d[k] for k in keys},
                       segments=[dict(s) for s in segs], peaks=[dict(p) for p in peaks])


# ==================== 点位 ====================

@app.get("/api/points/{code}", response_model=PointDetail, tags=["点位"], responses=ERR_404)
def get_point(code: str):
    p = q1("""SELECT pt.*, r.name AS route_name FROM points pt
              LEFT JOIN routes r ON r.id = pt.route_id WHERE pt.code = :code""", code=code)
    if not p:
        err(404, "POINT_NOT_FOUND", "点位不存在")
    top = q1("""SELECT c.id, c.text, c.like_count, c.bad_count, c.status, c.created_at,
                       u.nickname, (pt.maintainer_id = c.user_id) AS is_maintainer
                FROM comments c
                JOIN users u   ON u.id = c.user_id
                JOIN points pt ON pt.id = c.point_id
                WHERE c.point_id = :pid AND c.status <> 'hidden'
                ORDER BY is_maintainer DESC, (c.like_count - c.bad_count) DESC, c.created_at DESC
                LIMIT 1""", pid=p["id"])
    n = q1("SELECT count(*) AS n FROM visits WHERE point_id = :pid", pid=p["id"])
    d = dict(p)
    keys = ("id", "code", "type", "name", "route_id", "route_name", "index_in_route",
            "total_in_route", "level", "altitude", "guide", "status", "version")
    return PointDetail(**{k: d.get(k) for k in keys}, visitCount=n["n"],
                       topComment=CommentOut(**dict(top)) if top else None)


# ==================== 打卡 ====================

@app.post("/api/points/{point_id}/visit", response_model=VisitOut, tags=["打卡"],
          responses={**ERR_401, **ERR_404},
          summary="打卡（同一人 / 同一点位 / 同一天只计一次）")
def do_visit(body: VisitIn, point_id: int = Path(ge=1), uid: int = Depends(require_user)):
    """去重靠数据库唯一约束 (user_id, point_id, visit_date)，不靠代码判断。
    同日重复请求返回已存在的 seq，且 isFirstVisit=false。
    """
    if not q1("SELECT 1 AS x FROM points WHERE id = :id", id=point_id):
        err(404, "POINT_NOT_FOUND", "点位不存在")
    with engine.begin() as conn:
        row = conn.execute(text("""INSERT INTO visits (user_id, point_id, seq, visit_date, source)
            VALUES (:uid, :pid,
                    (SELECT coalesce(max(seq),0)+1 FROM visits WHERE point_id = :pid),
                    CURRENT_DATE, :src)
            ON CONFLICT (user_id, point_id, visit_date) DO NOTHING
            RETURNING seq"""), {"uid": uid, "pid": point_id, "src": body.source}).first()
        is_first = row is not None
        if not is_first:
            row = conn.execute(text("""SELECT seq FROM visits
                WHERE user_id=:uid AND point_id=:pid AND visit_date=CURRENT_DATE"""),
                {"uid": uid, "pid": point_id}).first()
    mine = q1("SELECT count(*) AS n FROM visits WHERE user_id=:uid AND point_id=:pid",
              uid=uid, pid=point_id)
    return VisitOut(seq=row[0], isFirstVisit=is_first, myVisitCount=mine["n"],
                    message=f"你是第 {row[0]} 位在这里留下痕迹的人")
