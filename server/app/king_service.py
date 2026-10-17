"""山大王申请、山头成员与山寨的状态机。

这个模块只接收 SQLAlchemy 连接与已经解析好的请求数据，不导入 app.main，
避免 uvicorn 启动时出现循环依赖。所有授权以 mountain_members 为准：
points.maintainer_id 与 claims 只作为历史兼容字段/审计记录，不能绕过新审核。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text


APP_DAYS = 3
OPEN_STATUSES = ("pending", "needs_info")
RESUBMIT_FROM = ("draft", "needs_info", "rejected", "expired", "withdrawn")


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def clean(value: Any) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def normalize_target_type(value: Any) -> str:
    value = clean(value) or "peak"
    if value not in ("peak", "junction"):
        raise ServiceError(422, "TARGET_TYPE_INVALID", "新山头类型只能是 peak 或 junction")
    return value


def lock_new_name(conn, name: str, point_type: str) -> None:
    key = (name.strip().lower() + ":" + point_type)[:240]
    conn.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": key})


def lock_review_target(conn, row, merge_mountain_id: int | None = None) -> None:
    """同一山头的审核按固定顺序排队，避免两个审批互相等对方锁住的申请行。"""
    if merge_mountain_id:
        key = "mountain:%d" % merge_mountain_id
    elif row["target_kind"] == "new":
        key = "new:%s:%s" % ((row["new_name"] or "").strip().lower(),
                             row["new_point_type"] or "peak")
    else:
        key = "mountain:%s" % (row["target_mountain_id"] or row["mountain_id"])
    conn.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                 {"k": key[:240]})


def next_code(conn) -> str:
    n = conn.execute(text("SELECT count(*) FROM short_links")).scalar_one() + 1041
    for i in range(200):
        code = "BJ-%04d" % (n + i)
        if not conn.execute(text("SELECT 1 FROM short_links WHERE code = :c"),
                            {"c": code}).first():
            return code
    raise ServiceError(500, "CODE_EXHAUSTED", "编号生成失败，请重试")


def notify(conn, user_id: int, kind: str, title: str, body: str | None = None,
           link: str | None = None, payload: dict | None = None) -> None:
    conn.execute(text("""INSERT INTO king_notifications
        (user_id, kind, title, body, link, payload)
        VALUES (:u, :kind, :title, :body, :link, CAST(:payload AS jsonb))"""),
        {"u": user_id, "kind": kind, "title": title, "body": body, "link": link,
         "payload": json.dumps(payload or {}, ensure_ascii=False)})


def audit(conn, actor_id: int, action: str, target_type: str, target_id: int,
          previous: dict | None = None, current: dict | None = None,
          reason: str | None = None, board_id: int | None = None) -> None:
    conn.execute(text("""INSERT INTO maintenance_audit_logs
        (actor_id, action, board_id, target_type, target_id, previous, current, reason)
        VALUES (:actor, :action, :board, :tt, :tid,
                CAST(:prev AS jsonb), CAST(:cur AS jsonb), :reason)"""),
        {"actor": actor_id, "action": action, "board": board_id,
         "tt": target_type, "tid": target_id,
         "prev": json.dumps(previous or {}, ensure_ascii=False, default=str),
         "cur": json.dumps(current or {}, ensure_ascii=False, default=str),
         "reason": reason})


def active_owner(conn, mountain_id: int):
    return conn.execute(text("""
        SELECT mm.*, u.nickname, u.username
          FROM mountain_members mm
          LEFT JOIN users u ON u.id = mm.user_id
         WHERE mm.mountain_id = :m AND mm.role = 'owner' AND mm.status = 'active'
         LIMIT 1"""), {"m": mountain_id}).mappings().first()


def membership(conn, mountain_id: int, user_id: int):
    return conn.execute(text("""
        SELECT * FROM mountain_members
         WHERE mountain_id = :m AND user_id = :u AND status = 'active'
         LIMIT 1"""), {"m": mountain_id, "u": user_id}).mappings().first()


def require_mountain_manager(conn, mountain_id: int, user_id: int, owner_only: bool = False):
    member = membership(conn, mountain_id, user_id)
    if not member or (owner_only and member["role"] != "owner"):
        raise ServiceError(403, "MOUNTAIN_MANAGE_FORBIDDEN",
                           "只有这座山头的负责人可以执行这个操作"
                           if owner_only else "你不在这个山头的管理成员里")
    return member


def mountain_context(conn, mountain_id: int):
    mountain = conn.execute(text("""
        SELECT m.*, b.id AS board_id,
               (SELECT count(*) FROM points p WHERE p.mountain_id = m.id
                  AND p.status = 'published') AS point_count
          FROM mountains m
          LEFT JOIN boards b ON b.mountain_id = m.id AND b.board_type = 'summit'
         WHERE m.id = :m"""), {"m": mountain_id}).mappings().first()
    if not mountain:
        raise ServiceError(404, "MOUNTAIN_NOT_FOUND", "山头不存在")
    points = conn.execute(text("""
        SELECT id, code, name, type, altitude, city, geom, status
          FROM points WHERE mountain_id = :m ORDER BY id"""),
        {"m": mountain_id}).mappings().all()
    if not points:
        raise ServiceError(409, "MOUNTAIN_HAS_NO_POINT", "这座山头还没有点位，不能申请")
    return mountain, points


def lead_point(points) -> Any:
    peak = next((p for p in points if p["type"] == "peak"), None)
    return peak or points[0]


def application_select() -> str:
    return """
        SELECT ma.*, pt.code AS point_code, pt.name AS point_name, pt.type AS point_type,
               m.name AS mountain_name, m.altitude AS mountain_altitude, m.region,
               owner.nickname AS owner_name, owner.id AS owner_id,
               cu.nickname AS applicant_name, cu.username AS applicant_username,
               c.name AS clan_name, c.status AS clan_status,
               b.id AS board_id
          FROM master_applications ma
          LEFT JOIN points pt ON pt.id = ma.point_id
          LEFT JOIN mountains m ON m.id = coalesce(ma.target_mountain_id, ma.mountain_id,
                                                   pt.mountain_id)
          LEFT JOIN LATERAL (
            SELECT mm.user_id, u.nickname, u.id
              FROM mountain_members mm JOIN users u ON u.id = mm.user_id
             WHERE mm.mountain_id = m.id AND mm.role = 'owner' AND mm.status = 'active'
             LIMIT 1) owner ON true
          LEFT JOIN users cu ON cu.id = ma.applicant_id
          LEFT JOIN clans c ON c.id = ma.clan_id
          LEFT JOIN boards b ON b.mountain_id = m.id AND b.board_type = 'summit'
    """


def application_row(conn, application_id: int, lock: bool = False):
    sql = application_select() + " WHERE ma.id = :id"
    if lock:
        sql += " FOR UPDATE OF ma"
    row = conn.execute(text(sql), {"id": application_id}).mappings().first()
    if not row:
        raise ServiceError(404, "APPLICATION_NOT_FOUND", "申请不存在")
    return row


def application_out(row, private: bool = False) -> dict:
    due = row["due_at"]
    delayed = bool(due and row["status"] in ("pending", "needs_info", "waiting_clan")
                   and due < datetime.now(timezone.utc))
    out = {
        "id": row["id"], "kind": row["kind"], "status": row["status"],
        "targetKind": row["target_kind"], "intent": row["intent"],
        "mountainId": row["target_mountain_id"] or row["mountain_id"],
        "mountainName": row["mountain_name"] or row["new_name"] or row["point_name"],
        "pointId": row["point_id"], "pointCode": row["point_code"] or row["new_name"],
        "pointType": row["point_type"] or row["new_point_type"] or "peak",
        "region": row["region"] or row["new_region"],
        "altitude": row["mountain_altitude"] or row["new_altitude"],
        "ownerName": row["owner_name"], "ownerId": row["owner_id"],
        "clanId": row["clan_id"], "clanName": row["clan_name"],
        "clanStatus": row["clan_status"],
        "boardId": row["board_id"],
        "reason": row["reason"], "expectations": row["expectations"],
        "visitsPerMonth": row["visits_per_month"],
        "nickname": row["nickname"], "dueAt": row["due_at"],
        "isDelayed": delayed,
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        "submittedAt": row["submitted_at"], "decidedAt": row["decided_at"],
        "reviewNote": row["review_note"], "needsInfoNote": row["needs_info_note"],
        "ownerOpinion": row["owner_opinion"],
        "ownerOpinionAt": row["owner_opinion_at"],
        "confirmedAt": row["confirmed_at"], "version": row["version"],
        "resultRole": row["result_role"],
        "newPointType": row["new_point_type"], "newName": row["new_name"],
        "newRegion": row["new_region"], "newLocationText": row["new_location_text"],
        "newLat": float(row["new_lat"]) if row["new_lat"] is not None else None,
        "newLng": float(row["new_lng"]) if row["new_lng"] is not None else None,
        "newAltitude": row["new_altitude"], "newIntro": row["new_intro"],
        "newGpxRef": row["new_gpx_ref"],
        "applicantName": row["applicant_name"] or row["applicant_username"],
    }
    if private:
        out["contact"] = row["contact"]
        out["applicantUsername"] = row["applicant_username"]
    return out


def infer_existing_target(conn, uid: int, mountain_id: int | None = None,
                          point_code: str | None = None) -> dict:
    if mountain_id is None and point_code:
        point = conn.execute(text("""SELECT mountain_id FROM points
            WHERE code = :c AND status <> 'draft' LIMIT 1"""),
            {"c": point_code.strip().upper()}).mappings().first()
        if not point or point["mountain_id"] is None:
            raise ServiceError(404, "POINT_NOT_FOUND", "这个点位还没有关联稳定山头")
        mountain_id = point["mountain_id"]
    if not mountain_id:
        raise ServiceError(422, "TARGET_REQUIRED", "请选择一个已有山头")
    mountain, points = mountain_context(conn, mountain_id)
    lead = lead_point(points)
    owner = active_owner(conn, mountain_id)
    clan = conn.execute(text("""SELECT * FROM clans WHERE mountain_id = :m
        AND status IN ('pending','active') ORDER BY id DESC LIMIT 1"""),
        {"m": mountain_id}).mappings().first()
    mine = membership(conn, mountain_id, uid)
    if mine and mine["role"] == "owner":
        intent = "owner"
    elif owner:
        intent = "join"
    else:
        intent = "owner"
    return {"mountain": mountain, "points": points, "lead": lead, "owner": owner,
            "clan": clan, "intent": intent, "mine": mine}


def _payload(conn, uid: int, data: dict, submit: bool) -> dict:
    target_kind = clean(data.get("targetKind")) or "existing"
    if target_kind not in ("existing", "new"):
        raise ServiceError(422, "TARGET_KIND_INVALID", "申请目标只能是已有山头或新山头")
    reason = clean(data.get("reason")) or ""
    plan = clean(data.get("expectations")) or clean(data.get("plan")) or ""
    visits = data.get("visitsPerMonth", 4)
    try:
        visits = int(visits)
    except (TypeError, ValueError):
        raise ServiceError(422, "VISITS_INVALID", "预计维护频率必须是 1–30 次/月")
    if submit:
        if len(reason) < 20 or len(reason) > 1000:
            raise ServiceError(422, "REASON_TOO_SHORT", "请写 20–1000 字说明为什么申请")
        if len(plan) < 20 or len(plan) > 2000:
            raise ServiceError(422, "PLAN_TOO_SHORT", "请写 20–2000 字经营计划")
        if not 1 <= visits <= 30:
            raise ServiceError(422, "VISITS_INVALID", "预计维护频率必须在 1–30 次/月")
    else:
        reason = reason or "草稿尚未填写：申请原因待补充"
        plan = plan or "草稿尚未填写：成为山头负责人后的经营计划待补充"
        if len(reason) < 20:
            reason = (reason + "（草稿占位，提交前请补充完整）")[:1000]
        if len(plan) < 20:
            plan = (plan + "（草稿占位，提交前请补充完整）")[:2000]
        reason = reason[:1000]
        plan = plan[:2000]
        visits = min(max(visits, 1), 30)

    result = {
        "target_kind": target_kind, "reason": reason, "expectations": plan,
        "visits": visits, "nickname": clean(data.get("nickname")),
        "contact": clean(data.get("contact")),
        "new_point_type": None, "new_name": None, "new_region": None,
        "new_location_text": None, "new_lat": None, "new_lng": None,
        "new_altitude": None, "new_intro": None, "new_gpx_ref": None,
        "point_id": None, "mountain_id": None, "intent": "owner",
        "kind": "solo", "clan_id": None, "clan_status": None,
    }
    if result["contact"] and len(result["contact"]) > 200:
        raise ServiceError(422, "CONTACT_TOO_LONG", "联系方式最多 200 字")

    if target_kind == "new":
        name = clean(data.get("newName"))
        if not name:
            if submit:
                raise ServiceError(422, "NEW_NAME_REQUIRED", "请填写新山头名称")
            name = "未命名新山头草稿"
        if len(name) > 80:
            raise ServiceError(422, "NEW_NAME_TOO_LONG", "山头名称最多 80 字")
        result.update({
            "new_point_type": normalize_target_type(data.get("newPointType")),
            "new_name": name, "new_region": clean(data.get("newRegion")),
            "new_location_text": clean(data.get("newLocationText")),
            "new_lat": data.get("newLat"), "new_lng": data.get("newLng"),
            "new_altitude": data.get("newAltitude"),
            "new_intro": clean(data.get("newIntro")),
            "new_gpx_ref": clean(data.get("newGpxRef")),
            "intent": "owner", "kind": "solo",
        })
        if submit:
            if not result["new_region"] or not result["new_location_text"]:
                raise ServiceError(422, "NEW_LOCATION_REQUIRED", "新山头要填写地区和准确位置")
            if result["new_intro"] and len(result["new_intro"]) > 2000:
                raise ServiceError(422, "INTRO_TOO_LONG", "介绍最多 2000 字")
        return result

    ctx = infer_existing_target(conn, uid, data.get("mountainId"), data.get("pointCode"))
    mountain = ctx["mountain"]
    result.update({
        "point_id": ctx["lead"]["id"], "mountain_id": mountain["id"],
        "intent": ctx["intent"], "kind": "clan" if ctx["intent"] == "join" else "solo",
        "clan_id": ctx["clan"]["id"] if ctx["clan"] else None,
        "clan_status": ctx["clan"]["status"] if ctx["clan"] else None,
    })
    # 已有负责人：有山寨才是正式加入申请；没有山寨时只记录意向，等山寨开放。
    if ctx["intent"] == "join":
        result["kind"] = "clan"
        if ctx["clan"] and ctx["clan"]["status"] == "active":
            result["status_hint"] = "pending"
        else:
            result["status_hint"] = "waiting_clan"
    else:
        result["status_hint"] = "pending"
    return result


def save_draft(conn, uid: int, data: dict, application_id: int | None = None) -> dict:
    payload = _payload(conn, uid, data, submit=False)
    if application_id:
        row = application_row(conn, application_id, lock=True)
        if row["applicant_id"] != uid:
            raise ServiceError(403, "APPLICATION_FORBIDDEN", "不能修改别人的申请")
        if row["status"] != "draft":
            raise ServiceError(409, "NOT_A_DRAFT", "只有草稿可以这样保存")
        version = data.get("version")
        version = row["version"] if version is None else int(version)
        if version != row["version"]:
            raise ServiceError(409, "VERSION_CONFLICT",
                               "草稿已在别处更新，请刷新后再改，避免覆盖")
        updated = conn.execute(text("""UPDATE master_applications SET
              target_kind=:target_kind, target_mountain_id=:mountain_id, point_id=:point_id,
              mountain_id=coalesce(:mountain_id, mountain_id), new_point_type=:new_point_type,
              new_name=:new_name, new_region=:new_region,
              new_location_text=:new_location_text, new_lat=:new_lat, new_lng=:new_lng,
              new_altitude=:new_altitude, new_intro=:new_intro, new_gpx_ref=:new_gpx_ref,
              reason=:reason, expectations=:expectations, visits_per_month=:visits,
              nickname=:nickname, contact=:contact, intent=:intent, kind=:kind,
              clan_id=:clan_id, version=version+1, updated_at=now()
            WHERE id=:id RETURNING *"""), {"id": application_id, **payload}).mappings().one()
    else:
        status_hint = payload.get("status_hint", "pending")
        updated = conn.execute(text("""INSERT INTO master_applications
            (applicant_id, target_kind, target_mountain_id, point_id, mountain_id,
             new_point_type, new_name, new_region, new_location_text, new_lat, new_lng,
             new_altitude, new_intro, new_gpx_ref, reason, expectations, visits_per_month,
             nickname, contact, intent, kind, clan_id, status, due_at)
            VALUES (:uid, :target_kind, :mountain_id, :point_id, :mountain_id,
             :new_point_type, :new_name, :new_region, :new_location_text,
             :new_lat, :new_lng, :new_altitude, :new_intro, :new_gpx_ref,
             :reason, :expectations, :visits, :nickname, :contact, :intent, :kind,
             :clan_id, 'draft', now() + interval '3 days')
            RETURNING *"""), {"uid": uid, **payload}).mappings().one()
    snapshot_version(conn, updated["id"], uid)
    return application_out(application_row(conn, updated["id"]), private=True)


def snapshot_version(conn, application_id: int, uid: int) -> None:
    row = conn.execute(text("SELECT * FROM master_applications WHERE id = :id"),
                       {"id": application_id}).mappings().one()
    snapshot = {k: (v.isoformat() if hasattr(v, "isoformat") else v)
                for k, v in dict(row).items()}
    conn.execute(text("""INSERT INTO king_application_versions
        (application_id, revision, snapshot, created_by)
        VALUES (:id, :rev, CAST(:snap AS jsonb), :uid)
        ON CONFLICT (application_id, revision) DO NOTHING"""),
        {"id": application_id, "rev": row["version"], "uid": uid,
         "snap": json.dumps(snapshot, ensure_ascii=False, default=str)})


def submit_application(conn, uid: int, data: dict) -> dict:
    application_id = data.get("id") or data.get("applicationId")
    payload = _payload(conn, uid, data, submit=True)
    status = payload.pop("status_hint", "pending")
    if application_id:
        row = application_row(conn, int(application_id), lock=True)
        if row["applicant_id"] != uid:
            raise ServiceError(403, "APPLICATION_FORBIDDEN", "不能提交别人的申请")
        if row["status"] not in RESUBMIT_FROM:
            raise ServiceError(409, "APPLICATION_CLOSED", "这份申请已经不能再提交")
        version = data.get("version")
        version = row["version"] if version is None else int(version)
        if version != row["version"]:
            raise ServiceError(409, "VERSION_CONFLICT", "申请已在别处更新，请刷新后再提交")
        updated = conn.execute(text("""UPDATE master_applications SET
              target_kind=:target_kind, target_mountain_id=:mountain_id, point_id=:point_id,
              mountain_id=coalesce(:mountain_id, mountain_id), new_point_type=:new_point_type,
              new_name=:new_name, new_region=:new_region,
              new_location_text=:new_location_text, new_lat=:new_lat, new_lng=:new_lng,
              new_altitude=:new_altitude, new_intro=:new_intro, new_gpx_ref=:new_gpx_ref,
              reason=:reason, expectations=:expectations, visits_per_month=:visits,
              nickname=:nickname, contact=:contact, intent=:intent, kind=:kind,
              clan_id=:clan_id, status=:status, version=version+1,
              submitted_at=now(), updated_at=now(), due_at=now() + interval '3 days',
              reviewer_id=NULL, decided_at=NULL, review_note=NULL, needs_info_note=NULL,
              result_role=NULL, confirmed_at=NULL
            WHERE id=:id RETURNING id"""),
            {"id": row["id"], "status": status, **payload}).mappings().one()
        app_id = updated["id"]
    else:
        updated = conn.execute(text("""INSERT INTO master_applications
            (applicant_id, target_kind, target_mountain_id, point_id, mountain_id,
             new_point_type, new_name, new_region, new_location_text, new_lat, new_lng,
             new_altitude, new_intro, new_gpx_ref, reason, expectations, visits_per_month,
             nickname, contact, intent, kind, clan_id, status, submitted_at, due_at)
            VALUES (:uid, :target_kind, :mountain_id, :point_id, :mountain_id,
             :new_point_type, :new_name, :new_region, :new_location_text,
             :new_lat, :new_lng, :new_altitude, :new_intro, :new_gpx_ref,
             :reason, :expectations, :visits, :nickname, :contact, :intent, :kind,
             :clan_id, :status, now(), now() + interval '3 days')
            RETURNING id"""), {"uid": uid, "status": status, **payload}).mappings().one()
        app_id = updated["id"]
    snapshot_version(conn, app_id, uid)
    audit(conn, uid, "king_application.submit", "king_application", app_id,
          {}, {"status": status, "targetKind": payload["target_kind"],
               "intent": payload["intent"]})
    notify(conn, uid, "application_submitted", "申请已提交",
           "平台会在 3 天内处理；需要补充资料时会保留原申请和版本。",
           "#/king/application/%d" % app_id, {"applicationId": app_id})
    return application_out(application_row(conn, app_id), private=True)


def withdraw(conn, uid: int, application_id: int, note: str | None = None) -> dict:
    row = application_row(conn, application_id, lock=True)
    if row["applicant_id"] != uid:
        raise ServiceError(403, "APPLICATION_FORBIDDEN", "不能撤回别人的申请")
    if row["status"] not in ("pending", "needs_info", "waiting_clan", "pending_confirmation"):
        raise ServiceError(409, "APPLICATION_CLOSED", "当前状态不能撤回")
    conn.execute(text("""UPDATE master_applications SET status='withdrawn',
        review_note=coalesce(:note, '申请人自己撤回'), decided_at=now(), updated_at=now()
        WHERE id=:id"""), {"id": application_id, "note": clean(note)})
    audit(conn, uid, "king_application.withdraw", "king_application", application_id,
          {"status": row["status"]}, {"status": "withdrawn"}, reason=clean(note))
    return {"withdrawn": True, "id": application_id}


def confirm_join(conn, uid: int, application_id: int) -> dict:
    row = application_row(conn, application_id, lock=True)
    if row["applicant_id"] != uid:
        raise ServiceError(403, "APPLICATION_FORBIDDEN", "不能确认别人的申请")
    if row["status"] != "pending_confirmation":
        raise ServiceError(409, "NOT_AWAITING_CONFIRMATION", "这份申请不在待确认状态")
    mountain_id = row["target_mountain_id"] or row["mountain_id"]
    target_point = row["point_id"]
    if target_point is None and mountain_id:
        points = conn.execute(text("SELECT id, type FROM points WHERE mountain_id=:m ORDER BY id"),
                              {"m": mountain_id}).mappings().all()
        if points:
            target_point = lead_point(points)["id"]
    if not mountain_id:
        raise ServiceError(409, "TARGET_MISSING", "原申请关联的山头已不存在")
    clan = conn.execute(text("SELECT id FROM clans WHERE mountain_id=:m AND status='active'"),
                        {"m": mountain_id}).mappings().first()
    next_status = "pending" if clan else "waiting_clan"
    conn.execute(text("""UPDATE master_applications SET status=:status, target_kind='existing',
        target_mountain_id=:m, point_id=:p, mountain_id=:m, intent='join', kind='clan',
        clan_id=:c, confirmed_at=now(), updated_at=now()
        WHERE id=:id"""), {"id": application_id, "m": mountain_id, "p": target_point,
                           "c": clan["id"] if clan else None, "status": next_status})
    notify(conn, uid, "application_confirmed", "已确认继续加入申请",
           ("等待山寨成立后转正式加入申请。" if not clan
            else "负责人意见与平台审核完成前，仍不会获得成员权限。"),
           "#/king/application/%d" % application_id, {"applicationId": application_id})
    return application_out(application_row(conn, application_id), private=True)


def _create_new_mountain(conn, row, uid: int, reviewer: int,
                         merge_mountain_id: int | None = None) -> int:
    point_type = row["new_point_type"] or "peak"
    name = row["new_name"]
    code = next_code(conn)
    if merge_mountain_id:
        mountain_id = merge_mountain_id
        mountain = conn.execute(text("SELECT * FROM mountains WHERE id=:m FOR UPDATE"),
                                {"m": mountain_id}).mappings().first()
        if not mountain:
            raise ServiceError(404, "MOUNTAIN_NOT_FOUND", "要关联的山头不存在")
    else:
        lock_new_name(conn, name, point_type)
        duplicate = conn.execute(text("""
            SELECT m.id FROM mountains m JOIN points p ON p.mountain_id=m.id
             WHERE lower(btrim(m.name))=lower(btrim(:n)) AND p.type=:t
               AND p.status='published' LIMIT 1"""),
            {"n": name, "t": point_type}).mappings().first()
        if duplicate:
            raise ServiceError(409, "DUPLICATE_TARGET_REVIEW",
                               "已有同名山头，请审核时明确关联或要求补充，不能只凭同名自动合并")
        mountain_id = conn.execute(text("""INSERT INTO mountains
            (stable_key, name, altitude, geom, region, intro, name_status)
            VALUES (:key, :name, :alt,
              CASE WHEN CAST(:lat AS DOUBLE PRECISION) IS NULL
                     OR CAST(:lng AS DOUBLE PRECISION) IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_MakePoint(CAST(:lng AS DOUBLE PRECISION),
                                                CAST(:lat AS DOUBLE PRECISION)), 4326) END,
              :region, :intro, 'candidate')
            RETURNING id"""), {
                "key": "king:" + code, "name": name, "alt": row["new_altitude"],
                "lat": row["new_lat"], "lng": row["new_lng"],
                "region": row["new_region"], "intro": row["new_intro"]}).scalar_one()
    point_id = conn.execute(text("""INSERT INTO points
        (code, type, name, level, status, mountain_id, altitude, maintainer_id,
         track_path, city)
        VALUES (:code, :type, :name, 'mid', 'published', :m, :alt, :uid,
                CASE WHEN CAST(:gpx AS TEXT) IS NULL THEN NULL
                     ELSE CAST(:gpx AS jsonb) END, :region)
        RETURNING id"""), {
            "code": code, "type": point_type, "name": name, "m": mountain_id,
            "alt": row["new_altitude"], "uid": uid, "gpx": row["new_gpx_ref"],
            "region": row["new_region"]}).scalar_one()
    conn.execute(text("INSERT INTO short_links (code, point_id) VALUES (:c, :p)"),
                 {"c": code, "p": point_id})
    conn.execute(text("""INSERT INTO boards (board_type, mountain_id)
        VALUES ('summit', :m) ON CONFLICT (mountain_id) DO NOTHING"""), {"m": mountain_id})
    conn.execute(text("""INSERT INTO claims
        (user_id, target_key, target_name, kind, code)
        VALUES (:uid, :key, :name, :kind, :code)
        ON CONFLICT (target_key) DO NOTHING"""), {
            "uid": uid, "key": "master:" + code, "name": name,
            "kind": point_type, "code": code})
    return mountain_id


def _grant_owner(conn, mountain_id: int, user_id: int, reviewer: int,
                 application_id: int | None) -> None:
    current = active_owner(conn, mountain_id)
    if current and current["user_id"] != user_id:
        raise ServiceError(409, "MOUNTAIN_ALREADY_OWNED", "这座山已经有负责人了")
    existing = membership(conn, mountain_id, user_id)
    if existing:
        conn.execute(text("""UPDATE mountain_members SET role='owner',
            granted_by=:r, granted_at=now(), source_application_id=:a, ended_at=NULL
            WHERE id=:id"""), {"r": reviewer, "a": application_id, "id": existing["id"]})
    else:
        conn.execute(text("""INSERT INTO mountain_members
            (mountain_id, user_id, role, status, source_application_id, granted_by, note)
            VALUES (:m, :u, 'owner', 'active', :a, :r, '审核授予')"""),
            {"m": mountain_id, "u": user_id, "a": application_id, "r": reviewer})
    conn.execute(text("""UPDATE points SET maintainer_id=:u
        WHERE mountain_id=:m AND status <> 'draft'"""), {"u": user_id, "m": mountain_id})


def _close_competitors(conn, row, mountain_id: int, reviewer: int,
                       clan_id: int | None) -> int:
    if row["target_kind"] == "new":
        rows = conn.execute(text("""UPDATE master_applications SET
              status='pending_confirmation', intent='join', kind='clan',
              target_mountain_id=:m, clan_id=:c, reviewer_id=:r, decided_at=now(),
              review_note='平台已通过另一位申请人的新山头申请；如仍想加入，请本人确认继续',
              updated_at=now()
            WHERE status='pending' AND id <> :id AND target_kind='new'
              AND lower(btrim(new_name))=lower(btrim(:name))
              AND coalesce(new_point_type,'peak')=coalesce(:type,'peak')
            RETURNING applicant_id, id"""), {
                "m": mountain_id, "c": clan_id, "r": reviewer, "id": row["id"],
                "name": row["new_name"], "type": row["new_point_type"]}).mappings().all()
    else:
        rows = conn.execute(text("""UPDATE master_applications SET
              status='pending_confirmation', intent='join', kind='clan',
              target_mountain_id=:m, clan_id=:c, reviewer_id=:r, decided_at=now(),
              review_note='平台已选择另一位申请人；如仍想加入，请本人确认继续',
              updated_at=now()
            WHERE status='pending' AND id <> :id AND intent='owner'
              AND coalesce(target_mountain_id, mountain_id)=:m
            RETURNING applicant_id, id"""), {
                "m": mountain_id, "c": clan_id, "r": reviewer, "id": row["id"]}).mappings().all()
    for other in rows:
        notify(conn, other["applicant_id"], "application_competition",
               "这份申请进入「待确认加入」",
               "平台已通过另一位申请人的负责人申请。只有你本人确认继续，才会转为加入申请。",
               "#/king/application/%d" % other["id"], {"applicationId": other["id"]})
    return len(rows)


def _clan_for_mountain(conn, mountain_id: int):
    return conn.execute(text("""SELECT * FROM clans WHERE mountain_id=:m
        AND status IN ('pending','active') ORDER BY id DESC LIMIT 1"""),
        {"m": mountain_id}).mappings().first()


def review_application(conn, application_id: int, reviewer: int, decision: str,
                       note: str, merge_mountain_id: int | None = None) -> dict:
    note = (note or "").strip()
    if decision in ("approved", "rejected") and len(note) < 6:
        raise ServiceError(422, "REVIEW_NOTE_REQUIRED", "审核说明至少 6 个字")
    preview = application_row(conn, application_id)
    lock_review_target(conn, preview, merge_mountain_id)
    row = application_row(conn, application_id, lock=True)
    if row["applicant_id"] == reviewer:
        raise ServiceError(403, "SELF_REVIEW_FORBIDDEN", "不能审核自己的申请")
    if row["status"] != "pending":
        raise ServiceError(409, "APPLICATION_CLOSED",
                           "这份申请当前是 %s，不能再次审核" % row["status"])
    if decision == "needs_info":
        conn.execute(text("""UPDATE master_applications SET status='needs_info',
            reviewer_id=:r, needs_info_note=:n, due_at=now() + interval '3 days',
            updated_at=now() WHERE id=:id"""),
            {"id": application_id, "r": reviewer, "n": note or "请补充资料后重新提交"})
        audit(conn, reviewer, "king_application.needs_info", "king_application",
              application_id, {"status": "pending"}, {"status": "needs_info"}, note)
        notify(conn, row["applicant_id"], "application_needs_info", "申请需要补充资料",
               note or "请补充资料后重新提交。", "#/king/application/%d" % application_id,
               {"applicationId": application_id})
        return {"id": application_id, "status": "needs_info"}
    if decision == "rejected":
        conn.execute(text("""UPDATE master_applications SET status='rejected',
            reviewer_id=:r, review_note=:n, decided_at=now(), updated_at=now()
            WHERE id=:id"""), {"id": application_id, "r": reviewer, "n": note})
        audit(conn, reviewer, "king_application.rejected", "king_application",
              application_id, {"status": "pending"}, {"status": "rejected"}, note)
        notify(conn, row["applicant_id"], "application_rejected", "申请未通过", note,
               "#/king/application/%d" % application_id, {"applicationId": application_id})
        return {"id": application_id, "status": "rejected"}

    if decision != "approved":
        raise ServiceError(422, "DECISION_INVALID", "未知审核结果")

    clan_id = row["clan_id"]
    auto_join = 0
    if row["intent"] == "owner":
        mountain_id = row["target_mountain_id"] or row["mountain_id"]
        if row["target_kind"] == "new":
            mountain_id = _create_new_mountain(conn, row, row["applicant_id"], reviewer,
                                               merge_mountain_id)
        if not mountain_id:
            raise ServiceError(409, "TARGET_MISSING", "申请没有可用的山头目标")
        # 锁住山头行，双审批时第二个请求会看到负责人已存在。
        conn.execute(text("SELECT id FROM mountains WHERE id=:m FOR UPDATE"),
                     {"m": mountain_id})
        _grant_owner(conn, mountain_id, row["applicant_id"], reviewer, application_id)
        clan = _clan_for_mountain(conn, mountain_id)
        clan_id = clan["id"] if clan and clan["status"] == "active" else None
        auto_join = _close_competitors(conn, row, mountain_id, reviewer, clan_id)
        conn.execute(text("""UPDATE master_applications SET status='approved',
            target_kind='existing', target_mountain_id=:m,
            point_id=coalesce(point_id, (SELECT id FROM points WHERE mountain_id=:m
                                ORDER BY CASE WHEN type='peak' THEN 0 ELSE 1 END, id LIMIT 1)),
            mountain_id=:m, reviewer_id=:r, review_note=:n, decided_at=now(),
            result_role='owner', updated_at=now() WHERE id=:id"""),
            {"id": application_id, "m": mountain_id, "r": reviewer, "n": note})
        result_role = "owner"
    else:
        mountain_id = row["target_mountain_id"] or row["mountain_id"]
        if not mountain_id:
            raise ServiceError(409, "TARGET_MISSING", "申请没有关联山头")
        clan = _clan_for_mountain(conn, mountain_id)
        if not clan or clan["status"] != "active":
            raise ServiceError(409, "CLAN_NOT_READY", "山寨尚未成立，不能直接授予成员身份")
        current = active_owner(conn, mountain_id)
        if current and current["user_id"] == row["applicant_id"]:
            raise ServiceError(409, "ALREADY_OWNER", "申请人已经是负责人")
        existing = membership(conn, mountain_id, row["applicant_id"])
        if existing and existing["role"] == "member":
            raise ServiceError(409, "ALREADY_MEMBER", "申请人已经是山寨成员")
        if not existing:
            conn.execute(text("""INSERT INTO mountain_members
                (mountain_id, user_id, role, status, source_application_id, granted_by, note)
                VALUES (:m, :u, 'member', 'active', :a, :r, '平台审核通过加入申请')"""),
                {"m": mountain_id, "u": row["applicant_id"], "a": application_id,
                 "r": reviewer})
        conn.execute(text("""UPDATE master_applications SET status='approved',
            clan_id=:c, mountain_id=:m, reviewer_id=:r, review_note=:n,
            decided_at=now(), result_role='member', updated_at=now() WHERE id=:id"""),
            {"id": application_id, "c": clan["id"], "m": mountain_id,
             "r": reviewer, "n": note})
        result_role = "member"
    audit(conn, reviewer, "king_application.approved", "king_application", application_id,
          {"status": "pending"}, {"status": "approved", "role": result_role,
                                  "autoJoin": auto_join}, note)
    notify(conn, row["applicant_id"], "application_approved", "申请已通过",
           "你现在可以从留言版进入「我管理的留言版」。" if result_role == "owner"
           else "你已成为山寨成员；权限由平台审核授予，负责人意见不能代替平台决定。",
           "#/board", {"applicationId": application_id, "role": result_role})
    return {"id": application_id, "status": "approved", "role": result_role,
            "autoJoin": auto_join}


def owner_opinion(conn, application_id: int, uid: int, opinion: str) -> dict:
    row = application_row(conn, application_id, lock=True)
    mountain_id = row["target_mountain_id"] or row["mountain_id"]
    if not mountain_id:
        raise ServiceError(409, "TARGET_MISSING", "申请没有关联山头")
    require_mountain_manager(conn, mountain_id, uid, owner_only=True)
    if row["applicant_id"] == uid:
        raise ServiceError(403, "SELF_REVIEW_FORBIDDEN", "负责人不能给自己的申请写意见")
    if row["status"] not in ("pending", "pending_confirmation", "waiting_clan"):
        raise ServiceError(409, "APPLICATION_CLOSED", "这份申请已经不在等待意见的状态")
    conn.execute(text("""UPDATE master_applications SET owner_opinion=:o,
        owner_opinion_by=:u, owner_opinion_at=now(), updated_at=now() WHERE id=:id"""),
        {"o": opinion.strip(), "u": uid, "id": application_id})
    audit(conn, uid, "king_application.submit", "king_application", application_id,
          {}, {"ownerOpinion": opinion.strip()}, "负责人意见")
    notify(conn, row["applicant_id"], "owner_opinion", "负责人已提交意见",
           "负责人意见会交给平台参考，最终是否加入仍由平台审核。",
           "#/king/application/%d" % application_id, {"applicationId": application_id})
    return {"id": application_id, "ownerOpinion": opinion.strip(),
            "note": "负责人意见已记录，不会直接授予成员身份"}


def create_clan(conn, mountain_id: int, uid: int, data: dict) -> dict:
    require_mountain_manager(conn, mountain_id, uid, owner_only=True)
    name = clean(data.get("name")) or ""
    intro = clean(data.get("intro")) or ""
    plan = clean(data.get("collaborationPlan") or data.get("plan")) or ""
    req = clean(data.get("recruitRequirements")) or ""
    if not 2 <= len(name) <= 40:
        raise ServiceError(422, "CLAN_NAME_INVALID", "山寨名称要 2–40 字")
    if not 20 <= len(intro) <= 2000:
        raise ServiceError(422, "CLAN_INTRO_INVALID", "山寨介绍要 20–2000 字")
    if not 20 <= len(plan) <= 2000:
        raise ServiceError(422, "CLAN_PLAN_INVALID", "协作计划要 20–2000 字")
    if not 10 <= len(req) <= 1000:
        raise ServiceError(422, "CLAN_REQ_INVALID", "招募要求要 10–1000 字")
    existing = conn.execute(text("SELECT * FROM clans WHERE mountain_id=:m FOR UPDATE"),
                            {"m": mountain_id}).mappings().first()
    if existing and existing["status"] in ("pending", "active"):
        raise ServiceError(409, "CLAN_EXISTS", "这座山已经有一份待审或已成立的山寨")
    if existing and existing["status"] == "rejected":
        row = conn.execute(text("""UPDATE clans SET name=:n, intro=:i,
            collaboration_plan=:p, recruit_requirements=:r, status='pending',
            reviewer_id=NULL, review_note=NULL, created_by=:u, created_at=now(),
            reviewed_at=NULL WHERE id=:id RETURNING *"""),
            {"id": existing["id"], "n": name, "i": intro, "p": plan, "r": req,
             "u": uid}).mappings().one()
    else:
        row = conn.execute(text("""INSERT INTO clans
            (mountain_id, name, intro, collaboration_plan, recruit_requirements,
             status, created_by)
            VALUES (:m, :n, :i, :p, :r, 'pending', :u) RETURNING *"""),
            {"m": mountain_id, "n": name, "i": intro, "p": plan, "r": req,
             "u": uid}).mappings().one()
    audit(conn, uid, "clan.create", "clan", row["id"], {}, {"status": "pending"})
    return clan_out(row)


def clan_out(row) -> dict:
    return {"id": row["id"], "mountainId": row["mountain_id"], "name": row["name"],
            "intro": row["intro"], "collaborationPlan": row["collaboration_plan"],
            "recruitRequirements": row["recruit_requirements"],
            "recruiting": row["recruiting"], "status": row["status"],
            "reviewNote": row["review_note"] if "review_note" in row.keys() else None,
            "createdAt": row["created_at"], "reviewedAt": row["reviewed_at"]}


def review_clan(conn, clan_id: int, reviewer: int, decision: str, note: str) -> dict:
    row = conn.execute(text("SELECT * FROM clans WHERE id=:id FOR UPDATE"),
                       {"id": clan_id}).mappings().first()
    if not row:
        raise ServiceError(404, "CLAN_NOT_FOUND", "山寨不存在")
    if row["created_by"] == reviewer:
        raise ServiceError(403, "SELF_REVIEW_FORBIDDEN", "不能审核自己创建的山寨")
    if row["status"] != "pending":
        raise ServiceError(409, "CLAN_CLOSED", "山寨已不在待审状态")
    if decision not in ("approved", "rejected"):
        raise ServiceError(422, "DECISION_INVALID", "审核结果只能是 approved 或 rejected")
    status = "active" if decision == "approved" else "rejected"
    conn.execute(text("""UPDATE clans SET status=:s, reviewer_id=:r, review_note=:n,
        reviewed_at=now() WHERE id=:id"""),
        {"id": clan_id, "s": status, "r": reviewer, "n": note})
    audit(conn, reviewer, "clan.review", "clan", clan_id,
          {"status": "pending"}, {"status": status}, note)
    if status == "active":
        waiting = conn.execute(text("""UPDATE master_applications SET
              status='pending_confirmation', clan_id=:c, reviewer_id=:r, decided_at=now(),
              review_note='山寨已成立，请本人确认是否继续加入', updated_at=now()
            WHERE status='waiting_clan' AND target_mountain_id=:m
            RETURNING id, applicant_id"""),
            {"c": clan_id, "r": reviewer, "m": row["mountain_id"]}).mappings().all()
        for app in waiting:
            notify(conn, app["applicant_id"], "clan_opened", "山寨已成立",
                   "你之前留下的加入意向仍有效。请本人确认继续，平台审核后才成为成员。",
                   "#/king/application/%d" % app["id"], {"applicationId": app["id"]})
    return {"id": clan_id, "status": status}


def managed_boards(conn, uid: int) -> list[dict]:
    rows = conn.execute(text("""
        SELECT mm.role, mm.mountain_id, m.name AS mountain_name, m.altitude, m.region,
               b.id AS board_id, c.id AS clan_id, c.name AS clan_name, c.status AS clan_status,
               owner.nickname AS owner_name,
               (SELECT count(*) FROM comments cm JOIN points pp ON pp.id=cm.point_id
                 WHERE pp.mountain_id=mm.mountain_id AND cm.status='flagged') AS pending_comments,
               (SELECT count(*) FROM comments cm JOIN points pp ON pp.id=cm.point_id
                 WHERE pp.mountain_id=mm.mountain_id AND cm.status='hidden') AS hidden_comments,
               (SELECT count(*) FROM master_applications a
                 WHERE coalesce(a.target_mountain_id,a.mountain_id)=mm.mountain_id
                   AND a.status IN ('pending','pending_confirmation')) AS pending_applications,
               (SELECT count(*) FROM master_applications a
                 WHERE coalesce(a.target_mountain_id,a.mountain_id)=mm.mountain_id
                   AND a.intent='join' AND a.status='pending') AS join_applications,
               (SELECT count(*) FROM comments cm JOIN points pp ON pp.id=cm.point_id
                 WHERE pp.mountain_id=mm.mountain_id AND cm.created_at > u.notif_seen_at
                   AND cm.status <> 'hidden') AS unread
          FROM mountain_members mm
          JOIN mountains m ON m.id=mm.mountain_id
          JOIN users u ON u.id=:u
          LEFT JOIN boards b ON b.mountain_id=mm.mountain_id AND b.board_type='summit'
          LEFT JOIN clans c ON c.mountain_id=mm.mountain_id AND c.status <> 'rejected'
          LEFT JOIN LATERAL (
            SELECT mu.nickname FROM mountain_members o JOIN users mu ON mu.id=o.user_id
             WHERE o.mountain_id=mm.mountain_id AND o.role='owner' AND o.status='active'
             LIMIT 1) owner ON true
         WHERE mm.user_id=:u AND mm.status='active'
         ORDER BY mm.role='owner' DESC, mm.granted_at DESC"""), {"u": uid}
        ).mappings().all()
    out = []
    for r in rows:
        points = conn.execute(text("""SELECT id, code, name, type FROM points
            WHERE mountain_id=:m AND status='published' ORDER BY id"""),
            {"m": r["mountain_id"]}).mappings().all()
        out.append({
            "mountainId": r["mountain_id"], "mountainName": r["mountain_name"],
            "altitude": r["altitude"], "region": r["region"],
            "boardId": r["board_id"], "role": r["role"], "ownerName": r["owner_name"],
            "clanId": r["clan_id"], "clanName": r["clan_name"],
            "clanStatus": r["clan_status"],
            "pendingComments": r["pending_comments"], "hiddenComments": r["hidden_comments"],
            "pendingApplications": r["pending_applications"],
            "joinApplications": r["join_applications"], "unread": r["unread"],
            "pointCodes": [p["code"] for p in points],
            "leadPointId": (lead_point(points)["id"] if points else None),
        })
    return out


def create_transfer(conn, mountain_id: int, uid: int, data: dict) -> dict:
    require_mountain_manager(conn, mountain_id, uid, owner_only=True)
    note = clean(data.get("note")) or ""
    if len(note) < 20:
        raise ServiceError(422, "TRANSFER_NOTE_REQUIRED", "请写至少 20 字说明移交原因")
    to_user_id = data.get("toUserId")
    if not to_user_id:
        username = clean(data.get("toUsername"))
        if not username:
            raise ServiceError(422, "SUCCESSOR_REQUIRED", "请选择接任人")
        target = conn.execute(text("SELECT id FROM users WHERE username=:u"),
                              {"u": username}).mappings().first()
        if not target:
            raise ServiceError(404, "USER_NOT_FOUND", "接任账号不存在")
        to_user_id = target["id"]
    if int(to_user_id) == uid:
        raise ServiceError(422, "SELF_TRANSFER", "不能把山头移交给自己")
    open_row = conn.execute(text("""SELECT id FROM transfer_applications
        WHERE mountain_id=:m AND status IN ('pending_accept','ready_review')"""),
        {"m": mountain_id}).mappings().first()
    if open_row:
        raise ServiceError(409, "TRANSFER_EXISTS", "这座山已有一份待处理的移交申请")
    row = conn.execute(text("""INSERT INTO transfer_applications
        (mountain_id, from_user_id, to_user_id, note)
        VALUES (:m, :f, :t, :n) RETURNING *"""),
        {"m": mountain_id, "f": uid, "t": int(to_user_id), "n": note}).mappings().one()
    audit(conn, uid, "member.transfer_request", "transfer", row["id"],
          {}, {"mountainId": mountain_id, "toUserId": int(to_user_id)}, note)
    notify(conn, int(to_user_id), "transfer_request", "有人邀请你接任山头负责人",
           "接任需要你本人确认，随后还要平台审核。", "#/me/managed",
           {"transferId": row["id"], "mountainId": mountain_id})
    return {"id": row["id"], "status": row["status"]}


def accept_transfer(conn, transfer_id: int, uid: int) -> dict:
    row = conn.execute(text("SELECT * FROM transfer_applications WHERE id=:id FOR UPDATE"),
                       {"id": transfer_id}).mappings().first()
    if not row:
        raise ServiceError(404, "TRANSFER_NOT_FOUND", "移交申请不存在")
    if row["to_user_id"] != uid:
        raise ServiceError(403, "NOT_SUCCESSOR", "只有接任人可以确认这份移交")
    if row["status"] != "pending_accept":
        raise ServiceError(409, "TRANSFER_CLOSED", "这份移交已经不能确认")
    current = active_owner(conn, row["mountain_id"])
    if not current or current["user_id"] != row["from_user_id"]:
        raise ServiceError(409, "OWNER_CHANGED", "现任负责人已变化，这份移交失效")
    conn.execute(text("""UPDATE transfer_applications SET status='ready_review',
        accepted_at=now() WHERE id=:id"""), {"id": transfer_id})
    audit(conn, uid, "member.transfer_accept", "transfer", transfer_id,
          {"status": "pending_accept"}, {"status": "ready_review"})
    return {"id": transfer_id, "status": "ready_review"}


def review_transfer(conn, transfer_id: int, reviewer: int, decision: str,
                    note: str) -> dict:
    row = conn.execute(text("SELECT * FROM transfer_applications WHERE id=:id FOR UPDATE"),
                       {"id": transfer_id}).mappings().first()
    if not row:
        raise ServiceError(404, "TRANSFER_NOT_FOUND", "移交申请不存在")
    if decision not in ("approved", "rejected"):
        raise ServiceError(422, "DECISION_INVALID", "审核结果只能是 approved 或 rejected")
    if row["status"] != "ready_review":
        raise ServiceError(409, "TRANSFER_NOT_READY", "接任人尚未确认或移交已结束")
    current = active_owner(conn, row["mountain_id"])
    if decision == "approved":
        if not current or current["user_id"] != row["from_user_id"]:
            raise ServiceError(409, "OWNER_CHANGED", "现任负责人已变化，不能重放这份移交")
        successor = conn.execute(text("""SELECT id FROM users WHERE id=:u AND deleted_at IS NULL"""),
                                 {"u": row["to_user_id"]}).first()
        if not successor:
            raise ServiceError(409, "SUCCESSOR_INVALID", "接任账号已不可用")
        conn.execute(text("""UPDATE mountain_members SET status='left', ended_at=now()
            WHERE mountain_id=:m AND user_id=:u AND role='owner' AND status='active'"""),
            {"m": row["mountain_id"], "u": row["from_user_id"]})
        existing = membership(conn, row["mountain_id"], row["to_user_id"])
        if existing:
            conn.execute(text("UPDATE mountain_members SET role='owner', granted_by=:r, granted_at=now() WHERE id=:id"),
                         {"r": reviewer, "id": existing["id"]})
        else:
            conn.execute(text("""INSERT INTO mountain_members
                (mountain_id, user_id, role, status, granted_by, note)
                VALUES (:m, :u, 'owner', 'active', :r, '移交审核通过')"""),
                {"m": row["mountain_id"], "u": row["to_user_id"], "r": reviewer})
        conn.execute(text("UPDATE points SET maintainer_id=:u WHERE mountain_id=:m"),
                     {"u": row["to_user_id"], "m": row["mountain_id"]})
        conn.execute(text("""INSERT INTO mountain_members
            (mountain_id, user_id, role, status, granted_by, note)
            SELECT :m, :u, 'member', 'active', :r, '移交后保留成员身份'
             WHERE NOT EXISTS (SELECT 1 FROM mountain_members
                WHERE mountain_id=:m AND user_id=:u AND status='active')"""),
            {"m": row["mountain_id"], "u": row["from_user_id"], "r": reviewer})
    conn.execute(text("""UPDATE transfer_applications SET status=:s, reviewer_id=:r,
        review_note=:n, reviewed_at=now() WHERE id=:id"""),
        {"id": transfer_id, "s": decision, "r": reviewer, "n": note})
    audit(conn, reviewer, "member.transfer_review", "transfer", transfer_id,
          {"status": "ready_review"}, {"status": decision}, note)
    notify(conn, row["from_user_id"], "transfer_review", "山头移交已处理", note,
           "#/me/managed", {"transferId": transfer_id})
    notify(conn, row["to_user_id"], "transfer_review", "山头移交已处理", note,
           "#/me/managed", {"transferId": transfer_id})
    return {"id": transfer_id, "status": decision}


def leave_mountain(conn, mountain_id: int, uid: int) -> dict:
    member = membership(conn, mountain_id, uid)
    if not member:
        raise ServiceError(404, "NOT_A_MEMBER", "你不在这个山头的成员里")
    if member["role"] == "owner":
        raise ServiceError(409, "TRANSFER_REQUIRED",
                           "负责人不能直接退出；请先提交移交，或由平台接管")
    conn.execute(text("""UPDATE mountain_members SET status='left', ended_at=now()
        WHERE id=:id"""), {"id": member["id"]})
    audit(conn, uid, "clan.leave", "mountain", mountain_id,
          {"role": "member"}, {"role": "left"})
    return {"left": True, "mountainId": mountain_id}


def request_member_removal(conn, mountain_id: int, uid: int, data: dict) -> dict:
    require_mountain_manager(conn, mountain_id, uid, owner_only=True)
    member_user_id = data.get("memberUserId")
    reason = clean(data.get("reason")) or ""
    if len(reason) < 8:
        raise ServiceError(422, "REMOVAL_REASON_REQUIRED", "请写至少 8 字移除理由")
    target = membership(conn, mountain_id, int(member_user_id or 0))
    if not target or target["role"] != "member":
        raise ServiceError(404, "MEMBER_NOT_FOUND", "要移除的成员不存在")
    row = conn.execute(text("""INSERT INTO member_removal_applications
        (mountain_id, member_user_id, requested_by, reason)
        VALUES (:m, :u, :r, :reason) RETURNING *"""),
        {"m": mountain_id, "u": int(member_user_id), "r": uid,
         "reason": reason}).mappings().one()
    audit(conn, uid, "member.remove", "member_removal", row["id"],
          {}, {"mountainId": mountain_id, "memberUserId": int(member_user_id)}, reason)
    return {"id": row["id"], "status": row["status"]}


def review_member_removal(conn, removal_id: int, reviewer: int, decision: str,
                          note: str) -> dict:
    row = conn.execute(text("""SELECT * FROM member_removal_applications
        WHERE id=:id FOR UPDATE"""), {"id": removal_id}).mappings().first()
    if not row:
        raise ServiceError(404, "REMOVAL_NOT_FOUND", "移除申请不存在")
    if row["status"] != "pending":
        raise ServiceError(409, "REMOVAL_CLOSED", "移除申请已处理")
    if decision not in ("approved", "rejected"):
        raise ServiceError(422, "DECISION_INVALID", "审核结果只能是 approved 或 rejected")
    if decision == "approved":
        conn.execute(text("""UPDATE mountain_members SET status='removed', ended_at=now()
            WHERE mountain_id=:m AND user_id=:u AND role='member' AND status='active'"""),
            {"m": row["mountain_id"], "u": row["member_user_id"]})
    conn.execute(text("""UPDATE member_removal_applications SET status=:s,
        reviewer_id=:r, review_note=:n, reviewed_at=now() WHERE id=:id"""),
        {"id": removal_id, "s": decision, "r": reviewer, "n": note})
    audit(conn, reviewer, "member.remove", "member_removal", removal_id,
          {"status": "pending"}, {"status": decision}, note)
    notify(conn, row["member_user_id"], "member_removal", "成员身份变更", note,
           "#/board", {"removalId": removal_id})
    return {"id": removal_id, "status": decision}


def takeover_mountain(conn, mountain_id: int, reviewer: int, note: str) -> dict:
    mountain = conn.execute(text("SELECT id FROM mountains WHERE id=:m FOR UPDATE"),
                            {"m": mountain_id}).first()
    if not mountain:
        raise ServiceError(404, "MOUNTAIN_NOT_FOUND", "山头不存在")
    conn.execute(text("""UPDATE mountain_members SET status='removed', ended_at=now(),
        note=coalesce(note,'') || ' / 平台接管' WHERE mountain_id=:m AND status='active'"""),
        {"m": mountain_id})
    conn.execute(text("UPDATE points SET maintainer_id=NULL WHERE mountain_id=:m"),
                 {"m": mountain_id})
    audit(conn, reviewer, "member.remove", "mountain", mountain_id,
          {"owned": True}, {"owned": False, "state": "platform_takeover"}, note)
    return {"mountainId": mountain_id, "state": "platform_takeover"}


def create_point_suggestion(conn, point_id: int, uid: int, data: dict) -> dict:
    point = conn.execute(text("SELECT mountain_id FROM points WHERE id=:p"),
                         {"p": point_id}).mappings().first()
    if not point or not point["mountain_id"]:
        raise ServiceError(404, "POINT_NOT_FOUND", "点位不存在")
    require_mountain_manager(conn, point["mountain_id"], uid)
    field_name = clean(data.get("field")) or ""
    value = clean(data.get("value")) or ""
    reason = clean(data.get("reason")) or ""
    if field_name not in ("name", "intro", "guide", "first_ascent", "ascent_method"):
        raise ServiceError(422, "FIELD_INVALID", "不支持修改这个字段")
    if not 1 <= len(value) <= 2000 or not 8 <= len(reason) <= 500:
        raise ServiceError(422, "SUGGESTION_INVALID", "修改内容与理由长度不符合要求")
    row = conn.execute(text("""INSERT INTO point_edit_suggestions
        (point_id, author_id, field_name, proposed_value, reason)
        VALUES (:p, :u, :f, :v, :r) RETURNING *"""),
        {"p": point_id, "u": uid, "f": field_name, "v": value, "r": reason}
        ).mappings().one()
    return {"id": row["id"], "status": row["status"],
            "message": "修改建议已提交平台审核；成员不能直接改他人原文"}
