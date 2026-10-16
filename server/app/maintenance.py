"""V3 保养作业：重试成绩配对、清理过期的原始定位，并留下可查的运行台账。

为什么要作业：计划 3.4 明确"排行榜故障或配对失败不使打卡失败"——打卡只负责
把到访写实，成绩是事后配对出来的。所以终点先到、起点后到、合并后重算这些情况
都由这里兜底重扫；计划 3.3 要求原始坐标 30 天后清空、只保留校验结果，也在这里做。

设计取舍：

* 两个作业各自跑、各自记台账，一个失败不影响另一个。
* 每次运行写一行 job_runs（running → ok/failed）。台账用独立事务写，
  这样作业本身的失败回滚不会把"失败"这件事也一起回滚掉。
* 台账 `detail` 只放计数与错误摘要，不放坐标、不放身份标识。
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import create_engine, text

from app.efforts import reconcile_efforts

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://hikes:hikes@db:5432/hikes")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# 重扫窗口要大于"最长的离线补传允许时间"（默认 30 天），否则边界上的到访会漏配。
RECONCILE_DAYS = int(os.getenv("V3_RECONCILE_DAYS", "31"))
PURGE_COORDINATE_DAYS = int(os.getenv("V3_PURGE_COORDINATE_DAYS", "30"))


def reconcile_recent_efforts(conn, days: int = RECONCILE_DAYS) -> dict:
    """重扫最近的身份×业务日，补齐漏掉的成绩配对。幂等：已存在的不再插。"""
    rows = conn.execute(text("""SELECT DISTINCT user_id, guest_id, visit_date FROM visits
        WHERE recorded_at >= now() - make_interval(days => :days)
          AND (user_id IS NOT NULL OR guest_id IS NOT NULL)"""),
        {"days": days}).mappings().all()
    created = 0
    failures = 0
    for row in rows:
        kind = "user" if row["user_id"] is not None else "guest"
        identity = row["user_id"] if row["user_id"] is not None else row["guest_id"]
        try:
            with conn.begin_nested():
                created += reconcile_efforts(conn, kind, identity, row["visit_date"])
        except Exception:  # noqa: BLE001
            failures += 1
            logging.exception("[v3-jobs] 成绩配对失败 user_id=%s guest_id=%s date=%s",
                              row["user_id"], row["guest_id"], row["visit_date"])
    return {"identityDays": len(rows), "efforts": created, "failures": failures}


def purge_visit_coordinates(conn, days: int = PURGE_COORDINATE_DAYS) -> dict:
    """到访满 30 天后清掉原始坐标与精度，保留"校验通过"这件事本身。"""
    result = conn.execute(text("""UPDATE visits SET location_geom = NULL, accuracy_m = NULL
        WHERE recorded_at < now() - make_interval(days => :days)
          AND (location_geom IS NOT NULL OR accuracy_m IS NOT NULL)"""),
        {"days": days})
    return {"cleared": result.rowcount, "days": days}


def run_job(name: str, work) -> dict:
    """跑一个作业并写台账；返回 {ok, detail|error, runId}。"""
    with engine.begin() as conn:
        run_id = conn.execute(text("""INSERT INTO job_runs (name, status)
            VALUES (:name, 'running') RETURNING id"""), {"name": name}).scalar_one()
    try:
        with engine.begin() as conn:
            detail = work(conn)
    except Exception as exc:  # noqa: BLE001
        logging.exception("[v3-jobs] %s 失败", name)
        with engine.begin() as conn:
            conn.execute(text("""UPDATE job_runs SET status='failed', finished_at=now(),
                detail = CAST(:detail AS jsonb) WHERE id=:id"""),
                {"id": run_id, "detail": json.dumps(
                    {"error": type(exc).__name__, "message": str(exc)[:300]})})
        return {"ok": False, "error": str(exc), "runId": run_id}
    with engine.begin() as conn:
        conn.execute(text("""UPDATE job_runs SET status='ok', finished_at=now(),
            detail = CAST(:detail AS jsonb) WHERE id=:id"""),
            {"id": run_id, "detail": json.dumps(detail)})
    return {"ok": True, "detail": detail, "runId": run_id}


def run_all() -> dict:
    """两个作业各跑一次；返回每个作业的结果，方便 cron/Compose 里看日志。"""
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    logging.warning("[v3-jobs] %s 开始", stamp)
    results = {
        "reconcile_efforts": run_job("reconcile_efforts", reconcile_recent_efforts),
        "purge_visit_coordinates": run_job("purge_visit_coordinates", purge_visit_coordinates),
    }
    for name, result in results.items():
        logging.warning("[v3-jobs] %s → %s", name, json.dumps(result, ensure_ascii=False))
    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    outcome = run_all()
    raise SystemExit(0 if all(item["ok"] for item in outcome.values()) else 1)
