"""统一山大王申请与山寨管理 HTTP 接口。

通过 build_king_router() 注入 main.py 的引擎和鉴权依赖，避免反向导入。
所有写接口都在事务内完成权限检查、状态迁移、审计与通知；失败整体回滚。
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Body, Depends, File, Form, Header, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from app import king_service as S
from app import route_media as M


class KingApplicationIn(BaseModel):
    id: int | None = None
    targetKind: Literal["existing", "new"] = "existing"
    mountainId: int | None = None
    pointCode: str | None = None
    newPointType: Literal["peak", "junction"] = "peak"
    newName: str | None = None
    newRegion: str | None = None
    newLocationText: str | None = None
    newLat: float | None = None
    newLng: float | None = None
    newAltitude: int | None = None
    newIntro: str | None = None
    newGpxRef: str | None = None
    reason: str = Field(default="", max_length=1000)
    expectations: str = Field(default="", max_length=2000)
    visitsPerMonth: int = 4
    nickname: str | None = Field(default=None, max_length=80)
    contact: str | None = Field(default=None, max_length=200)
    version: int | None = None


class DraftIn(KingApplicationIn):
    pass


class ReviewIn(BaseModel):
    decision: Literal["approved", "rejected", "needs_info"]
    note: str = Field(default="", max_length=500)
    mergeMountainId: int | None = None


class ClanIn(BaseModel):
    name: str
    intro: str
    collaborationPlan: str
    recruitRequirements: str


class ClanReviewIn(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str = Field(min_length=6, max_length=500)


class RecruitingIn(BaseModel):
    recruiting: bool


class JoinIn(BaseModel):
    message: str = Field(min_length=20, max_length=1000)
    visitsPerMonth: int = 4
    nickname: str | None = None
    contact: str | None = None


class OpinionIn(BaseModel):
    opinion: str = Field(min_length=8, max_length=500)


class TransferIn(BaseModel):
    toUserId: int | None = None
    toUsername: str | None = None
    note: str = Field(min_length=20, max_length=1000)


class TransferReviewIn(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str = Field(min_length=6, max_length=500)


class RemovalIn(BaseModel):
    memberUserId: int
    reason: str = Field(min_length=8, max_length=500)


class NoticeIn(BaseModel):
    text: str = Field(min_length=4, max_length=200)


class PinIn(BaseModel):
    pinned: bool


class SuggestionIn(BaseModel):
    field: Literal["name", "intro", "guide", "first_ascent", "ascent_method"]
    value: str = Field(min_length=1, max_length=2000)
    reason: str = Field(min_length=8, max_length=500)


class CoverReviewIn(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str = Field(min_length=6, max_length=500)


class RecommendationIn(BaseModel):
    note: str | None = Field(default=None, max_length=300)


def build_king_router(engine, err, require_user, require_reviewer):
    router = APIRouter()

    def run(fn):
        try:
            return fn()
        except S.ServiceError as exc:
            err(exc.status, exc.code, exc.message)

    def as_dict(body) -> dict:
        return body.model_dump() if hasattr(body, "model_dump") else dict(body)

    @router.get("/api/mountains/search", response_model=dict, tags=["占山为王"],
                summary="服务端全库检索山头与管理状态")
    def search_mountains(q: str = "", cursor: int | None = None, limit: int = 20,
                         authorization: str | None = Header(default=None)):
        keyword = (q or "").strip()
        limit = min(max(limit, 1), 50)
        viewer_id = None
        if authorization:
            try:
                viewer_id = require_user(authorization)
            except Exception:  # noqa: BLE001 - 公开检索不因过期令牌整体失败
                viewer_id = None
        with engine.begin() as conn:
            rows = conn.execute(text("""
                SELECT m.id, m.name, m.altitude, m.region,
                       (SELECT p.code FROM points p WHERE p.mountain_id=m.id
                         AND p.status='published'
                         ORDER BY CASE WHEN p.type='peak' THEN 0 ELSE 1 END, p.id
                         LIMIT 1) AS point_code,
                       (SELECT p.id FROM points p WHERE p.mountain_id=m.id
                         AND p.status='published'
                         ORDER BY CASE WHEN p.type='peak' THEN 0 ELSE 1 END, p.id
                         LIMIT 1) AS point_id,
                       (SELECT p.type FROM points p WHERE p.mountain_id=m.id
                         AND p.status='published'
                         ORDER BY CASE WHEN p.type='peak' THEN 0 ELSE 1 END, p.id
                         LIMIT 1) AS point_type,
                       owner.id AS owner_id, owner.nickname AS owner_name,
                       c.name AS clan_name, c.status AS clan_status
                  FROM mountains m
                  LEFT JOIN LATERAL (
                    SELECT u.id, u.nickname FROM mountain_members mm
                      JOIN users u ON u.id=mm.user_id
                     WHERE mm.mountain_id=m.id AND mm.role='owner' AND mm.status='active'
                     LIMIT 1) owner ON true
                  LEFT JOIN clans c ON c.mountain_id=m.id AND c.status IN ('pending','active')
                 WHERE (:kw = '' OR m.name ILIKE :like
                        OR EXISTS (SELECT 1 FROM points p
                                    WHERE p.mountain_id=m.id AND p.code ILIKE :like))
                   AND (CAST(:cursor AS BIGINT) IS NULL
                        OR m.id > CAST(:cursor AS BIGINT))
                 ORDER BY
                   CASE WHEN lower(coalesce(m.name,'')) = lower(:kw) THEN 0
                        WHEN coalesce(m.name,'') ILIKE :prefix THEN 1 ELSE 2 END,
                   m.id
                 LIMIT :limit"""), {
                     "kw": keyword, "like": "%" + keyword + "%",
                     "prefix": keyword + "%", "cursor": cursor, "limit": limit
                 }).mappings().all()
        items = [{"mountainId": r["id"], "name": r["name"],
                  "altitude": r["altitude"], "region": r["region"],
                  "pointCode": r["point_code"], "pointId": r["point_id"],
                  "pointType": r["point_type"],
                  "ownerId": r["owner_id"], "ownerName": r["owner_name"],
                  "isOwner": bool(viewer_id and r["owner_id"] == viewer_id),
                  "clanName": r["clan_name"], "clanStatus": r["clan_status"],
                  "intent": "owner" if (viewer_id and r["owner_id"] == viewer_id)
                  else "join" if r["owner_name"] else "owner"} for r in rows]
        return {"items": items,
                "nextCursor": items[-1]["mountainId"] if len(items) == limit else None}

    @router.get("/api/me/king-applications", response_model=list[dict],
                tags=["占山为王"], summary="我的统一申请与草稿")
    def my_applications(uid: int = Depends(require_user)):
        with engine.begin() as conn:
            rows = conn.execute(text(S.application_select() +
                                     " WHERE ma.applicant_id=:u ORDER BY ma.updated_at DESC"),
                                {"u": uid}).mappings().all()
            return [S.application_out(row, private=True) for row in rows]

    @router.get("/api/king-applications/{application_id}", response_model=dict,
                tags=["占山为王"], summary="申请详情；联系方式只对申请人与审核员可见")
    def get_application(application_id: int, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            row = S.application_row(conn, application_id)
            reviewer = conn.execute(text("""SELECT 1 FROM system_roles
                WHERE user_id=:u AND role='collaboration_reviewer'"""),
                {"u": uid}).first()
            if row["applicant_id"] != uid and not reviewer:
                err(403, "APPLICATION_FORBIDDEN", "无权读取这份申请")
            return S.application_out(row, private=bool(row["applicant_id"] == uid or reviewer))

    @router.post("/api/me/king-application-drafts", response_model=dict,
                 tags=["占山为王"], summary="创建账号私有草稿")
    def create_draft(body: DraftIn, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.save_draft(conn, uid, as_dict(body))

    @router.get("/api/me/king-application-drafts/{application_id}", response_model=dict,
                tags=["占山为王"], summary="读取自己的草稿（含版本号）")
    def get_draft(application_id: int, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            row = S.application_row(conn, application_id)
            if row["applicant_id"] != uid:
                err(403, "APPLICATION_FORBIDDEN", "不能读取别人的草稿")
            return S.application_out(row, private=True)

    @router.put("/api/me/king-application-drafts/{application_id}", response_model=dict,
                tags=["占山为王"], summary="保存草稿（乐观版本控制）")
    def put_draft(application_id: int, body: DraftIn, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.save_draft(conn, uid, as_dict(body), application_id)

    @router.post("/api/king-applications", response_model=dict, tags=["占山为王"],
                 summary="提交统一申请；已有山头自动判定负责人或加入意向")
    def submit_application(body: KingApplicationIn, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.submit_application(conn, uid, as_dict(body))

    @router.post("/api/king-applications/{application_id}/withdraw", response_model=dict,
                 tags=["占山为王"], summary="撤回自己的待审申请")
    def withdraw_application(application_id: int, body: dict = Body(default={}),
                             uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.withdraw(conn, uid, application_id, body.get("note"))

    @router.post("/api/king-applications/{application_id}/resubmit", response_model=dict,
                 tags=["占山为王"], summary="在需补充的原申请上再次提交")
    def resubmit_application(application_id: int, body: KingApplicationIn,
                             uid: int = Depends(require_user)):
        data = as_dict(body)
        data["id"] = application_id
        with engine.begin() as conn:
            return S.submit_application(conn, uid, data)

    @router.post("/api/king-applications/{application_id}/confirm-join", response_model=dict,
                 tags=["占山为王"], summary="本人确认从山大王申请转为加入申请")
    def confirm_join(application_id: int, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.confirm_join(conn, uid, application_id)

    @router.get("/api/admin/king-applications", response_model=list[dict],
                tags=["占山为王"], summary="平台审核队列")
    def admin_applications(
            status: Literal["pending", "needs_info", "pending_confirmation",
                            "waiting_clan", "approved", "rejected"] = "pending",
            limit: int = 50, uid: int = Depends(require_reviewer)):
        with engine.begin() as conn:
            rows = conn.execute(text(S.application_select() +
                                     " WHERE ma.status=:s ORDER BY ma.created_at LIMIT :l"),
                                {"s": status, "l": min(max(limit, 1), 100)}).mappings().all()
            return [S.application_out(row, private=True) for row in rows]

    @router.post("/api/admin/king-applications/{application_id}/review", response_model=dict,
                 tags=["占山为王"], summary="通过、驳回或要求补充资料")
    def review_application(application_id: int, body: ReviewIn,
                           uid: int = Depends(require_reviewer)):
        with engine.begin() as conn:
            return S.review_application(conn, application_id, uid, body.decision,
                                        body.note, body.mergeMountainId)

    @router.post("/api/clan-join-applications/{application_id}/review", response_model=dict,
                 tags=["山寨"], summary="平台对加入申请做最终审核")
    def review_join(application_id: int, body: ReviewIn,
                    uid: int = Depends(require_reviewer)):
        if body.decision == "needs_info":
            err(422, "DECISION_INVALID", "加入申请只支持通过或驳回")
        with engine.begin() as conn:
            return S.review_application(conn, application_id, uid, body.decision, body.note)

    @router.post("/api/clan-join-applications/{application_id}/owner-opinion",
                 response_model=dict, tags=["山寨"],
                 summary="负责人提交接纳/拒绝意见；不直接授权")
    def owner_opinion(application_id: int, body: OpinionIn,
                      uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.owner_opinion(conn, application_id, uid, body.opinion)

    @router.get("/api/me/managed-boards", response_model=list[dict], tags=["留言板"],
                summary="我管理的留言版")
    def my_managed_boards(uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.managed_boards(conn, uid)

    @router.get("/api/me/managed-boards/{mountain_id}", response_model=dict,
                tags=["留言板"], summary="授权后的留言版管理详情")
    def managed_board_detail(mountain_id: int, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            member = S.membership(conn, mountain_id, uid)
            if not member:
                err(403, "BOARD_MANAGE_FORBIDDEN", "你无权管理这个留言版")
            mountain = conn.execute(text("""SELECT m.*, b.id AS board_id,
                       (SELECT p.id FROM points p WHERE p.mountain_id=m.id
                         ORDER BY CASE WHEN p.type='peak' THEN 0 ELSE 1 END, p.id
                         LIMIT 1) AS lead_point_id
                  FROM mountains m LEFT JOIN boards b ON b.mountain_id=m.id
                 WHERE m.id=:m"""), {"m": mountain_id}).mappings().first()
            if not mountain:
                err(404, "MOUNTAIN_NOT_FOUND", "山头不存在")
            comments = conn.execute(text("""
                SELECT c.id, c.text, c.status, c.pinned, c.hidden_reason, c.created_at,
                       u.nickname, p.code AS point_code
                  FROM comments c JOIN points p ON p.id=c.point_id
                  LEFT JOIN users u ON u.id=c.user_id
                 WHERE p.mountain_id=:m AND c.status <> 'normal'
                 ORDER BY c.pinned DESC, c.created_at DESC LIMIT 100"""),
                {"m": mountain_id}).mappings().all()
            audit_rows = conn.execute(text("""
                SELECT a.id, a.action, a.reason, a.created_at, u.nickname
                  FROM maintenance_audit_logs a LEFT JOIN users u ON u.id=a.actor_id
                 WHERE a.board_id=(SELECT id FROM boards WHERE mountain_id=:m
                                    AND board_type='summit')
                 ORDER BY a.created_at DESC LIMIT 50"""), {"m": mountain_id}).mappings().all()
            points = conn.execute(text("""SELECT id, code, name, type, status
                FROM points WHERE mountain_id=:m ORDER BY id"""),
                {"m": mountain_id}).mappings().all()
            apps = conn.execute(text(S.application_select() +
                """ WHERE coalesce(ma.target_mountain_id, ma.mountain_id)=:m
                    AND ma.status IN ('pending','pending_confirmation','needs_info',
                                      'waiting_clan','approved')
                    ORDER BY ma.created_at DESC LIMIT 50"""),
                {"m": mountain_id}).mappings().all()
            clan = conn.execute(text("""SELECT * FROM clans WHERE mountain_id=:m
                ORDER BY id DESC LIMIT 1"""), {"m": mountain_id}).mappings().first()
            members = conn.execute(text("""SELECT mm.user_id, mm.role, mm.status,
                       mm.granted_at, u.nickname
                  FROM mountain_members mm LEFT JOIN users u ON u.id=mm.user_id
                 WHERE mm.mountain_id=:m AND mm.status='active'
                 ORDER BY mm.role='owner' DESC, mm.granted_at"""),
                {"m": mountain_id}).mappings().all()
            return {
                "mountainId": mountain_id, "mountainName": mountain["name"],
                "boardId": mountain["board_id"], "role": member["role"],
                "points": [dict(p) for p in points],
                "applications": [S.application_out(a) for a in apps],
                "clan": S.clan_out(clan) if clan else None,
                "members": [{"userId": m["user_id"], "role": m["role"],
                             "nickname": m["nickname"], "status": m["status"],
                             "grantedAt": m["granted_at"]} for m in members],
                "hidden": [{"id": c["id"], "text": c["text"], "status": c["status"],
                            "pinned": c["pinned"], "reason": c["hidden_reason"],
                            "nickname": c["nickname"], "pointCode": c["point_code"],
                            "createdAt": c["created_at"]}
                           for c in comments],
                "audit": [{"id": a["id"], "action": a["action"], "reason": a["reason"],
                           "actor": a["nickname"], "createdAt": a["created_at"]}
                          for a in audit_rows],
            }

    @router.post("/api/boards/{board_id}/notices", response_model=dict, tags=["留言板"],
                 summary="负责人或成员发布置顶公告")
    def create_notice(board_id: int, body: NoticeIn, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            board = conn.execute(text("""SELECT mountain_id FROM boards
                WHERE id=:b AND board_type='summit'"""), {"b": board_id}).mappings().first()
            if not board:
                err(404, "BOARD_NOT_FOUND", "留言版不存在")
            S.require_mountain_manager(conn, board["mountain_id"], uid)
            point = conn.execute(text("""SELECT id FROM points WHERE mountain_id=:m
                ORDER BY CASE WHEN type='peak' THEN 0 ELSE 1 END, id LIMIT 1"""),
                {"m": board["mountain_id"]}).mappings().first()
            if not point:
                err(409, "BOARD_HAS_NO_POINT", "留言版没有可发布的点位")
            row = conn.execute(text("""INSERT INTO comments
                (point_id, user_id, text, pinned) VALUES (:p, :u, :t, TRUE)
                RETURNING id, created_at"""),
                {"p": point["id"], "u": uid, "t": body.text.strip()}).mappings().one()
            S.audit(conn, uid, "board.notice", "comment", row["id"],
                    {}, {"pinned": True}, body.text.strip(), board_id=board_id)
            return {"id": row["id"], "createdAt": row["created_at"], "pinned": True}

    @router.post("/api/comments/{comment_id}/pin", response_model=dict, tags=["留言板"],
                 summary="置顶/取消置顶；只有本山头管理成员可以操作")
    def pin_comment(comment_id: int, body: PinIn, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            row = conn.execute(text("""SELECT c.id, c.pinned, p.mountain_id, p.id AS point_id
                FROM comments c JOIN points p ON p.id=c.point_id WHERE c.id=:id"""),
                {"id": comment_id}).mappings().first()
            if not row:
                err(404, "COMMENT_NOT_FOUND", "留言不存在")
            S.require_mountain_manager(conn, row["mountain_id"], uid)
            conn.execute(text("UPDATE comments SET pinned=:p WHERE id=:id"),
                         {"p": body.pinned, "id": comment_id})
            S.audit(conn, uid, "board.pin", "comment", comment_id,
                    {"pinned": row["pinned"]}, {"pinned": body.pinned})
            return {"id": comment_id, "pinned": body.pinned}

    @router.post("/api/points/{point_id}/suggestions", response_model=dict,
                 tags=["留言板"], summary="成员提交资料修改建议")
    def create_suggestion(point_id: int, body: SuggestionIn,
                          uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.create_point_suggestion(conn, point_id, uid, as_dict(body))

    @router.post("/api/mountains/{mountain_id}/clan-applications", response_model=dict,
                 tags=["山寨"], summary="负责人组建山寨，交平台审核")
    def create_clan(mountain_id: int, body: ClanIn, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.create_clan(conn, mountain_id, uid, as_dict(body))

    @router.get("/api/mountains/{mountain_id}/clan", response_model=dict, tags=["山寨"])
    def get_clan(mountain_id: int):
        with engine.begin() as conn:
            row = conn.execute(text("""SELECT c.*, m.name AS mountain_name
                FROM clans c JOIN mountains m ON m.id=c.mountain_id
                WHERE c.mountain_id=:m ORDER BY c.id DESC LIMIT 1"""),
                {"m": mountain_id}).mappings().first()
            if not row:
                return {"clan": None}
            members = conn.execute(text("""SELECT mm.user_id, mm.role, u.nickname
                FROM mountain_members mm LEFT JOIN users u ON u.id=mm.user_id
                WHERE mm.mountain_id=:m AND mm.status='active'
                ORDER BY mm.role='owner' DESC, mm.granted_at"""),
                {"m": mountain_id}).mappings().all()
            out = S.clan_out(row)
            out["mountainName"] = row["mountain_name"]
            out["members"] = [{"userId": m["user_id"], "role": m["role"],
                               "nickname": m["nickname"]} for m in members]
            return {"clan": out}

    @router.post("/api/clans/{clan_id}/join-applications", response_model=dict,
                 tags=["山寨"], summary="提交加入山寨申请")
    def join_clan(clan_id: int, body: JoinIn, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            clan = conn.execute(text("""SELECT c.*, m.name AS mountain_name
                FROM clans c JOIN mountains m ON m.id=c.mountain_id
                WHERE c.id=:c"""), {"c": clan_id}).mappings().first()
            if not clan:
                err(404, "CLAN_NOT_FOUND", "山寨不存在")
            if clan["status"] != "active" or not clan["recruiting"]:
                err(409, "CLAN_NOT_RECRUITING", "山寨尚未开放招募")
            data = {"targetKind": "existing", "mountainId": clan["mountain_id"],
                    "reason": body.message,
                    "expectations": "愿意遵守山寨协作规则，参与本山头留言板与路况维护",
                    "visitsPerMonth": body.visitsPerMonth,
                    "nickname": body.nickname, "contact": body.contact}
            return S.submit_application(conn, uid, data)

    @router.post("/api/clans/{clan_id}/recruiting", response_model=dict, tags=["山寨"])
    def set_recruiting(clan_id: int, body: RecruitingIn, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            clan = conn.execute(text("SELECT * FROM clans WHERE id=:c"),
                                {"c": clan_id}).mappings().first()
            if not clan:
                err(404, "CLAN_NOT_FOUND", "山寨不存在")
            S.require_mountain_manager(conn, clan["mountain_id"], uid, owner_only=True)
            if clan["status"] != "active":
                err(409, "CLAN_NOT_ACTIVE", "山寨尚未通过审核")
            conn.execute(text("UPDATE clans SET recruiting=:r WHERE id=:c"),
                         {"r": body.recruiting, "c": clan_id})
            return {"id": clan_id, "recruiting": body.recruiting}

    @router.get("/api/admin/clans", response_model=list[dict], tags=["山寨"])
    def admin_clans(status: Literal["pending", "active", "rejected", "closed"] = "pending",
                    uid: int = Depends(require_reviewer)):
        with engine.begin() as conn:
            rows = conn.execute(text("""SELECT c.*, m.name AS mountain_name,
                       u.nickname AS creator_name
                  FROM clans c JOIN mountains m ON m.id=c.mountain_id
                  LEFT JOIN users u ON u.id=c.created_by
                 WHERE c.status=:s ORDER BY c.created_at"""), {"s": status}).mappings().all()
            out = []
            for row in rows:
                item = S.clan_out(row)
                item["mountainName"] = row["mountain_name"]
                item["creatorName"] = row["creator_name"]
                out.append(item)
            return out

    @router.post("/api/admin/clans/{clan_id}/review", response_model=dict, tags=["山寨"])
    def review_clan(clan_id: int, body: ClanReviewIn,
                    uid: int = Depends(require_reviewer)):
        with engine.begin() as conn:
            return S.review_clan(conn, clan_id, uid, body.decision, body.note)

    @router.post("/api/clans/{clan_id}/leave", response_model=dict, tags=["山寨"])
    def leave_clan(clan_id: int, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            clan = conn.execute(text("SELECT mountain_id FROM clans WHERE id=:c"),
                                {"c": clan_id}).mappings().first()
            if not clan:
                err(404, "CLAN_NOT_FOUND", "山寨不存在")
            return S.leave_mountain(conn, clan["mountain_id"], uid)

    @router.post("/api/mountains/{mountain_id}/transfer-applications",
                 response_model=dict, tags=["移交"])
    def create_transfer(mountain_id: int, body: TransferIn,
                        uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.create_transfer(conn, mountain_id, uid, as_dict(body))

    @router.post("/api/transfers/{transfer_id}/accept", response_model=dict, tags=["移交"])
    def accept_transfer(transfer_id: int, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.accept_transfer(conn, transfer_id, uid)

    @router.post("/api/transfers/{transfer_id}/decline", response_model=dict, tags=["移交"])
    def decline_transfer(transfer_id: int, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.decline_transfer(conn, transfer_id, uid)

    @router.post("/api/transfers/{transfer_id}/review", response_model=dict, tags=["移交"])
    def review_transfer(transfer_id: int, body: TransferReviewIn,
                        uid: int = Depends(require_reviewer)):
        with engine.begin() as conn:
            return S.review_transfer(conn, transfer_id, uid, body.decision, body.note)

    @router.post("/api/mountains/{mountain_id}/member-removal-applications",
                 response_model=dict, tags=["移交"])
    def request_removal(mountain_id: int, body: RemovalIn,
                        uid: int = Depends(require_user)):
        with engine.begin() as conn:
            return S.request_member_removal(conn, mountain_id, uid, as_dict(body))

    @router.post("/api/admin/member-removals/{removal_id}/review", response_model=dict,
                 tags=["移交"])
    def review_removal(removal_id: int, body: TransferReviewIn,
                       uid: int = Depends(require_reviewer)):
        with engine.begin() as conn:
            return S.review_member_removal(conn, removal_id, uid, body.decision, body.note)

    @router.post("/api/admin/mountains/{mountain_id}/takeover", response_model=dict,
                 tags=["移交"], summary="负责人失联时由平台接管，保留全部历史内容")
    def takeover(mountain_id: int, body: dict = Body(default={}),
                 uid: int = Depends(require_reviewer)):
        note = (body.get("note") or "").strip()
        if len(note) < 8:
            err(422, "NOTE_REQUIRED", "请写至少 8 字接管原因")
        with engine.begin() as conn:
            return S.takeover_mountain(conn, mountain_id, uid, note)

    @router.get("/api/me/king-notifications", response_model=list[dict], tags=["占山为王"])
    def my_notifications(limit: int = Query(default=30, ge=1, le=100),
                         uid: int = Depends(require_user)):
        with engine.begin() as conn:
            rows = conn.execute(text("""SELECT * FROM king_notifications
                WHERE user_id=:u ORDER BY created_at DESC LIMIT :l"""),
                {"u": uid, "l": limit}).mappings().all()
            return [{"id": r["id"], "kind": r["kind"], "title": r["title"],
                     "body": r["body"], "link": r["link"],
                     "payload": r["payload"], "readAt": r["read_at"],
                     "createdAt": r["created_at"]} for r in rows]

    @router.post("/api/me/king-notifications/read", response_model=dict,
                 tags=["占山为王"])
    def read_notifications(uid: int = Depends(require_user)):
        with engine.begin() as conn:
            changed = conn.execute(text("""UPDATE king_notifications SET read_at=now()
                WHERE user_id=:u AND read_at IS NULL"""), {"u": uid}).rowcount
            return {"read": changed}

    # ============ 路书封面 ============
    def cover_out(row) -> dict:
        return {
            "id": row["id"], "routeId": row["route_id"], "routeSlug": row.get("route_slug"),
            "submitterId": row["submitter_id"], "submitterName": row.get("submitter_name"),
            "url": M.public_url(row["storage_key"]),
            "thumbnailUrl": M.public_url(row["thumbnail_key"]),
            "photographer": row["photographer"], "shotAt": row["shot_at"],
            "caption": row["caption"], "status": row["status"],
            "reviewNote": row["review_note"], "createdAt": row["created_at"],
            "reviewedAt": row["reviewed_at"],
            "recommendations": row.get("recommendations", 0),
        }

    @router.get("/media/{filename}", include_in_schema=False)
    def cover_file(filename: str):
        """只有已通过审核的存储键能读；待审/驳回/撤回文件即使知道键也不公开。"""
        if not filename or "/" in filename or "\\" in filename or filename.startswith("."):
            err(404, "MEDIA_NOT_FOUND", "图片不存在")
        with engine.begin() as conn:
            ok = conn.execute(text("""SELECT 1 FROM route_cover_submissions
                WHERE status='approved' AND (storage_key=:k OR thumbnail_key=:k)
                LIMIT 1"""), {"k": filename}).first()
        if not ok:
            err(404, "MEDIA_NOT_FOUND", "图片不存在")
        path = M.root() / filename
        if not path.is_file():
            err(404, "MEDIA_NOT_FOUND", "图片不存在")
        return FileResponse(path, media_type="image/jpeg",
                            headers={"Cache-Control": "public, max-age=86400"})

    @router.post("/api/routes/{slug}/cover-submissions", response_model=dict,
                 tags=["路书封面"], summary="投稿真实封面；只接受 JPEG/PNG/WebP")
    def submit_cover(slug: str, file: UploadFile = File(...),
                     photographer: str = Form(...),
                     shotAt: str = Form(default=""),
                     caption: str = Form(default=""),
                     licenseConfirmed: bool = Form(...),
                     uid: int = Depends(require_user)):
        if not licenseConfirmed:
            err(422, "LICENSE_REQUIRED", "必须确认拥有照片使用权并同意平台展示")
        name = (photographer or "").strip()
        if not 1 <= len(name) <= 80:
            err(422, "PHOTOGRAPHER_REQUIRED", "请填写拍摄者署名")
        caption_text = (caption or "").strip() or None
        if caption_text and len(caption_text) > 300:
            err(422, "CAPTION_TOO_LONG", "说明最多 300 字")
        with engine.begin() as conn:
            route = conn.execute(text("SELECT id FROM routes WHERE slug=:s"),
                                 {"s": slug}).mappings().first()
        if not route:
            err(404, "ROUTE_NOT_FOUND", "线路不存在")
        raw = file.file.read(M.MAX_BYTES + 1)
        try:
            stored = M.store(raw)
        except M.MediaError as exc:
            err(422, exc.code, exc.message)
        try:
            with engine.begin() as conn:
                row = conn.execute(text("""INSERT INTO route_cover_submissions
                    (route_id, submitter_id, storage_key, thumbnail_key, photographer,
                     shot_at, caption, license_confirmed)
                    VALUES (:r, :u, :k, :t, :p,
                            CAST(NULLIF(:shot,'') AS date), :c, TRUE)
                    RETURNING *"""), {
                        "r": route["id"], "u": uid, "k": stored["storage_key"],
                        "t": stored["thumbnail_key"], "p": name,
                        "shot": (shotAt or "").strip(), "c": caption_text}).mappings().one()
        except Exception:
            M.delete(stored["storage_key"], stored["thumbnail_key"])
            raise
        return cover_out(row)

    @router.get("/api/routes/{slug}/cover", response_model=dict, tags=["路书封面"])
    def approved_cover(slug: str):
        with engine.begin() as conn:
            row = conn.execute(text("""SELECT c.*, u.nickname AS submitter_name
                FROM route_cover_submissions c
                JOIN routes r ON r.id=c.route_id
                LEFT JOIN users u ON u.id=c.submitter_id
                WHERE r.slug=:s AND c.status='approved'
                ORDER BY c.reviewed_at DESC LIMIT 1"""), {"s": slug}).mappings().first()
            return {"cover": cover_out(row) if row else None}

    @router.get("/api/me/cover-submissions", response_model=list[dict], tags=["路书封面"])
    def my_covers(uid: int = Depends(require_user)):
        with engine.begin() as conn:
            rows = conn.execute(text("""SELECT c.*, r.slug AS route_slug
                FROM route_cover_submissions c JOIN routes r ON r.id=c.route_id
                WHERE c.submitter_id=:u ORDER BY c.created_at DESC LIMIT 50"""),
                {"u": uid}).mappings().all()
            return [cover_out(r) for r in rows]

    @router.post("/api/me/cover-submissions/{submission_id}/withdraw",
                 response_model=dict, tags=["路书封面"])
    def withdraw_cover(submission_id: int, uid: int = Depends(require_user)):
        with engine.begin() as conn:
            row = conn.execute(text("""SELECT * FROM route_cover_submissions
                WHERE id=:id FOR UPDATE"""), {"id": submission_id}).mappings().first()
            if not row:
                err(404, "COVER_NOT_FOUND", "封面投稿不存在")
            if row["submitter_id"] != uid:
                err(403, "COVER_FORBIDDEN", "不能撤回别人的投稿")
            if row["status"] != "pending":
                err(409, "COVER_CLOSED", "只有在审投稿可以撤回")
            conn.execute(text("""UPDATE route_cover_submissions SET status='withdrawn',
                reviewed_at=now() WHERE id=:id"""), {"id": submission_id})
            keys = [row["storage_key"], row["thumbnail_key"]]
        M.delete(*keys)
        return {"id": submission_id, "status": "withdrawn"}

    @router.post("/api/routes/{slug}/cover-recommendations", response_model=dict,
                 tags=["路书封面"], summary="关联山头负责人/成员推荐封面，不直接替换")
    def recommend_cover(slug: str, submission_id: int,
                        body: RecommendationIn = Body(default=RecommendationIn()),
                        uid: int = Depends(require_user)):
        with engine.begin() as conn:
            route = conn.execute(text("SELECT id FROM routes WHERE slug=:s"),
                                 {"s": slug}).mappings().first()
            if not route:
                err(404, "ROUTE_NOT_FOUND", "线路不存在")
            submission = conn.execute(text("""SELECT * FROM route_cover_submissions
                WHERE id=:id AND route_id=:r"""),
                {"id": submission_id, "r": route["id"]}).mappings().first()
            if not submission:
                err(404, "COVER_NOT_FOUND", "这条线路没有该封面投稿")
            mine = conn.execute(text("""
                SELECT 1 FROM route_peaks rp
                JOIN mountain_members mm ON mm.mountain_id=rp.mountain_id
                WHERE rp.route_id=:r AND mm.user_id=:u AND mm.status='active'
                LIMIT 1"""), {"r": route["id"], "u": uid}).first()
            if not mine:
                err(403, "COVER_RECOMMEND_FORBIDDEN",
                    "只有关联线路的山头管理成员可以推荐；推荐不等于直接替换封面")
            conn.execute(text("""INSERT INTO route_cover_recommendations
                (submission_id, user_id, note) VALUES (:s, :u, :n)
                ON CONFLICT (submission_id, user_id)
                DO UPDATE SET note=EXCLUDED.note, created_at=now()"""),
                {"s": submission_id, "u": uid, "n": (body.note or "").strip() or None})
            return {"submissionId": submission_id, "recommended": True,
                    "message": "推荐已记录；管理员审核后才会成为公开封面"}

    @router.get("/api/admin/cover-submissions", response_model=list[dict], tags=["路书封面"])
    def admin_covers(status: Literal["pending", "approved", "rejected", "withdrawn"] = "pending",
                     uid: int = Depends(require_reviewer)):
        with engine.begin() as conn:
            rows = conn.execute(text("""SELECT c.*, r.slug AS route_slug,
                       u.nickname AS submitter_name,
                       (SELECT count(*) FROM route_cover_recommendations rr
                         WHERE rr.submission_id=c.id) AS recommendations
                FROM route_cover_submissions c
                JOIN routes r ON r.id=c.route_id
                LEFT JOIN users u ON u.id=c.submitter_id
                WHERE c.status=:s ORDER BY c.created_at"""), {"s": status}).mappings().all()
            return [cover_out(r) for r in rows]

    @router.post("/api/admin/cover-submissions/{submission_id}/review",
                 response_model=dict, tags=["路书封面"])
    def review_cover(submission_id: int, body: CoverReviewIn,
                     uid: int = Depends(require_reviewer)):
        old_keys = []
        with engine.begin() as conn:
            row = conn.execute(text("""SELECT * FROM route_cover_submissions
                WHERE id=:id FOR UPDATE"""), {"id": submission_id}).mappings().first()
            if not row:
                err(404, "COVER_NOT_FOUND", "封面投稿不存在")
            if row["submitter_id"] == uid:
                err(403, "SELF_REVIEW_FORBIDDEN", "不能审核自己投稿的封面")
            if row["status"] != "pending":
                err(409, "COVER_CLOSED", "这条投稿已经处理过")
            if body.decision == "approved":
                previous = conn.execute(text("""SELECT storage_key, thumbnail_key
                    FROM route_cover_submissions WHERE route_id=:r AND status='approved'
                    FOR UPDATE"""), {"r": row["route_id"]}).mappings().all()
                old_keys = [k for p in previous
                            for k in (p["storage_key"], p["thumbnail_key"])]
                conn.execute(text("""UPDATE route_cover_submissions SET status='deleted',
                    review_note='已被新的审核封面替换', reviewed_at=now()
                    WHERE route_id=:r AND status='approved'"""), {"r": row["route_id"]})
            conn.execute(text("""UPDATE route_cover_submissions SET status=:s,
                reviewer_id=:u, review_note=:n, reviewed_at=now() WHERE id=:id"""),
                {"id": submission_id, "s": body.decision, "u": uid,
                 "n": body.note.strip()})
            S.notify(conn, row["submitter_id"], "cover_review", "封面投稿已处理",
                     body.note.strip(),
                     "/app/#/trails/" + str(conn.execute(
                         text("SELECT slug FROM routes WHERE id=:r"),
                         {"r": row["route_id"]}).scalar_one()),
                     {"submissionId": submission_id})
        if body.decision == "approved":
            M.delete(*old_keys)
        return {"id": submission_id, "status": body.decision}

    return router
