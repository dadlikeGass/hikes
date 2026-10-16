"""Pair configured ascent-course visits and read the public leaderboard."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import text


def reconcile_efforts(conn, identity_type: str, identity_id: int, visit_date) -> int:
    """把某个身份某个业务日的起终点配对成成绩，返回写入/重算的行数。

    重算是计划 3.4 明确要的（"修复任务可重算"）：到访数据变了（补传、合并、
    现场时间被校正）之后，成绩的用时与资格必须跟着变，而不是留着第一次算出来的旧结论。
    冲突键用 (course_id, start_visit_id, end_visit_id)，所以重复跑是幂等的。
    """
    column = "user_id" if identity_type == "user" else "guest_id"
    courses = conn.execute(text("""SELECT c.id, c.start_point_id, c.end_point_id,
        c.min_duration_s, c.ranking_enabled FROM ascent_courses c
        JOIN visits v ON v.point_id IN (c.start_point_id,c.end_point_id)
        WHERE v.visit_date=:day AND v.""" + column + "=:identity GROUP BY c.id"),
        {"day": visit_date, "identity": identity_id}).mappings().all()
    created = 0
    for course in courses:
        visits = conn.execute(text("""SELECT id, point_id, occurred_at, recorded_at,
            evidence_level FROM visits WHERE """ + column + "=:identity"
            " AND visit_date=:day AND point_id IN (:start,:end)"),
            {"identity": identity_id, "day": visit_date,
             "start": course["start_point_id"], "end": course["end_point_id"]}).mappings().all()
        start = next((v for v in visits if v["point_id"] == course["start_point_id"]), None)
        end = next((v for v in visits if v["point_id"] == course["end_point_id"]), None)
        if not start or not end or end["occurred_at"] <= start["occurred_at"]:
            continue
        duration = int((end["occurred_at"] - start["occurred_at"]).total_seconds())
        if duration > 12 * 3600:
            continue
        reason = None
        if not course["ranking_enabled"]:
            reason = "course_unverified"
        elif identity_type != "user":
            reason = "guest"
        elif duration < course["min_duration_s"]:
            reason = "too_fast"
        elif any(v["evidence_level"] not in ("code", "gps_close") for v in (start, end)):
            reason = "weak_evidence"
        elif any(v["recorded_at"] - v["occurred_at"] > timedelta(minutes=5)
                 for v in (start, end)):
            reason = "offline_submission"
        row = conn.execute(text("""INSERT INTO segment_efforts
            (user_id, guest_id, course_id, start_visit_id, end_visit_id, visit_date,
             start_at, end_at, duration_s, eligible, excluded_reason)
            VALUES (:user,:guest,:course,:start_visit,:end_visit,:day,
                :start_at,:end_at,:duration,:eligible,:reason)
                ON CONFLICT (course_id, start_visit_id, end_visit_id) DO UPDATE SET
                  duration_s = EXCLUDED.duration_s,
                  start_at = EXCLUDED.start_at,
                  end_at = EXCLUDED.end_at,
                  eligible = EXCLUDED.eligible,
                  excluded_reason = EXCLUDED.excluded_reason
                RETURNING id"""),
            {"user": identity_id if identity_type == "user" else None,
             "guest": identity_id if identity_type == "guest" else None,
             "course": course["id"], "start_visit": start["id"], "end_visit": end["id"],
             "day": visit_date, "start_at": start["occurred_at"], "end_at": end["occurred_at"],
             "duration": duration, "eligible": reason is None, "reason": reason}).first()
        created += int(row is not None)
    return created
