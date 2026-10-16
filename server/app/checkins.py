"""Shared visit recording rules for account and guest check-ins."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import text

BUSINESS_ZONE = ZoneInfo("Asia/Shanghai")


def _reject(status: int, code: str, message: str) -> None:
    raise HTTPException(status, detail={"error": {"code": code, "message": message}})


def record_visit(conn, *, identity_type: str, identity_id: int, point_id: int,
                 source: str, client_uuid: str | None = None,
                 occurred_at: datetime | None = None, lat: float | None = None,
                 lng: float | None = None, accuracy_m: int | None = None):
    """Record one daily visit; return (visit row, is_new).

    Caller owns the transaction. A point row lock serializes sequence assignment
    across guest and account identities. A repeated UUID with changed input is 409.
    """
    if identity_type not in ("guest", "user"):
        raise ValueError("unsupported identity type")
    now = datetime.now(timezone.utc)
    declared_at = occurred_at
    occurred = occurred_at or now
    if occurred.tzinfo is None:
        _reject(422, "TIMEZONE_REQUIRED", "现场时间必须带时区")
    occurred = occurred.astimezone(timezone.utc)
    if occurred > now + timedelta(minutes=5):
        _reject(422, "VISIT_TIME_IN_FUTURE", "手机时间超前，请校准后重试")
    if occurred < now - timedelta(days=30):
        _reject(422, "VISIT_TOO_OLD", "这条离线记录超过30天，请联系维护人")
    try:
        action_id = uuid.UUID(client_uuid) if client_uuid else uuid.uuid4()
    except ValueError:
        _reject(422, "INVALID_CLIENT_UUID", "打卡编号无效")
    payload = {"pointId": point_id, "source": source,
               "occurredAt": declared_at.astimezone(timezone.utc).isoformat() if declared_at else None,
               "lat": lat, "lng": lng, "accuracyM": accuracy_m}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    # 先锁点位行：同一个点位的打卡（含同一 UUID 的并发重试）在这里排队，
    # 这样发号不会撞号，重复提交也不会在唯一键上打成 500。
    point = conn.execute(text("""SELECT id, type, status, geom IS NOT NULL AS has_geom
        FROM points WHERE id=:id FOR UPDATE"""), {"id": point_id}).mappings().first()
    if not point:
        _reject(404, "POINT_NOT_FOUND", "点位不存在")
    receipt = conn.execute(text("""SELECT payload_hash, canonical_visit_id
        FROM visit_submission_receipts
        WHERE identity_type=:type AND identity_id=:identity AND client_uuid=:uuid
        FOR UPDATE"""), {"type": identity_type, "identity": identity_id,
                         "uuid": action_id}).mappings().first()
    if receipt:
        if receipt["payload_hash"] != digest:
            _reject(409, "CLIENT_UUID_REUSED", "同一打卡编号提交了不同内容")
        row = conn.execute(text("""SELECT id, seq, visit_date, occurred_at, recorded_at
            FROM visits WHERE id=:id"""), {"id": receipt["canonical_visit_id"]}).mappings().first()
        if not row:
            _reject(409, "VISIT_MERGED", "该记录已合并，请重新载入凭证")
        return row, False

    evidence = "code" if source == "scan" else "manual"
    if source == "nearby":
        if point["status"] != "published":
            _reject(422, "GPS_NOT_ENABLED", "该点位尚未开放定位打卡")
        if lat is None or lng is None or accuracy_m is None:
            _reject(422, "LOCATION_REQUIRED", "定位打卡需要位置和精度")
        if not (-90 <= lat <= 90 and -180 <= lng <= 180 and 0 <= accuracy_m <= 50):
            _reject(422, "LOCATION_INACCURATE", "定位精度不足，请重试或扫码")
        if not point["has_geom"]:
            _reject(422, "POINT_LOCATION_MISSING", "该点位还未开放定位打卡")
        distance = conn.execute(text("""SELECT ST_Distance(
            geom::geography, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography)
            FROM points WHERE id=:id"""), {"id": point_id, "lat": lat, "lng": lng}).scalar_one()
        radius = 100 if point["type"] == "peak" else 150
        if distance > radius:
            _reject(422, "OUTSIDE_CHECKIN_RADIUS", "距离点位较远，请靠近后重试或扫码")
        evidence = "gps_close"

    day = occurred.astimezone(BUSINESS_ZONE).date()
    identity_column = "guest_id" if identity_type == "guest" else "user_id"
    row = conn.execute(text(f"""INSERT INTO visits
        ({identity_column}, point_id, seq, visit_date, source, occurred_at,
         recorded_at, evidence_level, accuracy_m, location_geom)
        VALUES (:identity, :point,
            (SELECT coalesce(max(seq),0)+1 FROM visits WHERE point_id=:point),
            :day, :source, :occurred, now(), :evidence, :accuracy,
            CASE WHEN CAST(:lat AS float8) IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint(:lng,:lat),4326) END)
        ON CONFLICT ({identity_column}, point_id, visit_date)
        {"WHERE guest_id IS NOT NULL" if identity_type == "guest" else ""}
        DO NOTHING RETURNING id, seq, visit_date, occurred_at, recorded_at"""),
        {"identity": identity_id, "point": point_id, "day": day,
         "source": source, "occurred": occurred, "evidence": evidence,
         "accuracy": accuracy_m, "lat": lat, "lng": lng}).mappings().first()
    is_new = row is not None
    if row is None:
        row = conn.execute(text(f"""SELECT id, seq, visit_date, occurred_at, recorded_at
            FROM visits WHERE {identity_column}=:identity AND point_id=:point
            AND visit_date=:day"""),
            {"identity": identity_id, "point": point_id, "day": day}).mappings().one()
    conn.execute(text("""INSERT INTO visit_submission_receipts
        (identity_type, identity_id, client_uuid, payload_hash, canonical_visit_id)
        VALUES (:type,:identity,:uuid,:hash,:visit)
        ON CONFLICT (identity_type, identity_id, client_uuid) DO NOTHING"""),
        {"type": identity_type, "identity": identity_id, "uuid": action_id,
         "hash": digest, "visit": row["id"]})
    return row, is_new
