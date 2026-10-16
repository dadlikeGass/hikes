"""试点上登路线配置（V3 计划 T1）。

为什么需要单独的配置脚本：计划 3.4 说得很清楚——**一条完整上登路线未必等于
一个已有分段**，必须人工核实后配置；无法确认坐标的点位要关闭 GPS 与公开榜。
现在的真实数据是：1563 座峰顶有坐标，156 个登山口既没有坐标也没有挂到山上，
所以试点只能先写成"待现场采集"的工单，脚本负责校验、报告与落库。

用法（容器里跑，工作目录 /srv；这里用单行命令，避免文档里出现续行符）：

    python /srv/seeds/v3_pilot_courses.py --config /srv/seeds/v3_pilot_courses.json
    python /srv/seeds/v3_pilot_courses.py --config /srv/seeds/v3_pilot_courses.json --apply --coordinates-verified

硬规则：

* 起终点必须属于配置里写的山、必须都存在、不能是同一点。
* 只要有一端缺坐标，这条路线就不允许开榜（ranking_enabled 强制 false），
  只作为个人参考用时；报告里会写明缺哪一端。
* ranking_enabled=true 还要额外给 --coordinates-verified，否则脚本改回 false 并提示，
  防止"顺手"把没核实的路线推上公开榜。
* 幂等：唯一键 (mountain_id, start_point_id, end_point_id, name)，重复执行不产生第二行。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import create_engine, text

DEFAULT_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "v3_pilot_courses.json")


def _resolve_mountain(conn, spec):
    """按 stable_key 或山名找山；都找不到返回 None。"""
    if not spec:
        return None
    return conn.execute(text("""
        SELECT id, stable_key, name FROM mountains
         WHERE stable_key = :key OR name = :key ORDER BY id LIMIT 1"""),
        {"key": spec}).mappings().first()


def _resolve_point(conn, spec):
    """找端点：spec 只给 code 时按编号查；带 lat/lng 时允许脚本建点。"""
    code = (spec or {}).get("code")
    if not code:
        return None, "端点没有编号"
    row = conn.execute(text("""
        SELECT id, code, type, status, mountain_id, geom IS NOT NULL AS has_geom
          FROM points WHERE code = :code"""), {"code": code.upper()}).mappings().first()
    if row:
        return row, None
    lat, lng = spec.get("lat"), spec.get("lng")
    if lat is None or lng is None:
        return None, "点位 %s 还不存在，配置里也没有坐标（待现场采集）" % code
    return {"id": None, "code": code.upper(), "type": spec.get("type", "trailhead"),
            "status": "draft", "mountain_id": None, "has_geom": True,
            "create": {"lat": lat, "lng": lng}}, None


def plan_courses(conn, courses, *, coordinates_verified: bool):
    """把配置解析成可执行计划：每条路线一个 dict，含 action / problems / 目标行。"""
    plan = []
    for course in courses:
        problems = []
        name = course.get("name") or "(未命名)"
        mountain = _resolve_mountain(conn, course.get("mountain"))
        if not mountain:
            plan.append({"name": name, "action": "skip", "course": course,
                         "problems": ["拒绝：找不到山 %s" % course.get("mountain")]})
            continue
        start, start_problem = _resolve_point(conn, course.get("start_point"))
        end, end_problem = _resolve_point(conn, course.get("end_point"))
        for problem in (start_problem, end_problem):
            if problem:
                problems.append(problem)
        if start and end and start["code"] == end["code"]:
            problems.append("拒绝：起点和终点是同一个点位")
        for label, row in (("起点", start), ("终点", end)):
            if row and row.get("id") and row["mountain_id"] != mountain["id"]:
                problems.append("拒绝：%s %s 不属于这座山" % (label, row["code"]))
        missing_coords = [label for label, row in (("起点", start), ("终点", end))
                          if row and not row.get("has_geom")]
        if missing_coords:
            problems.append("%s缺坐标：GPS 打卡与公开榜必须保持关闭" % "、".join(missing_coords))
        wants_ranking = bool(course.get("ranking_enabled"))
        if wants_ranking and (missing_coords or not coordinates_verified):
            reason = ("坐标不全" if missing_coords else "本次没有 --coordinates-verified")
            problems.append("配置要求开榜，但%s，已降级为参考成绩" % reason)
            wants_ranking = False
        # 端点还没落库，或者有硬伤（拒绝项）时只报告，不写半截路线。
        blocked = any(problem.startswith("拒绝：") for problem in problems)
        action = "write" if (start and end and not blocked) else "skip"
        plan.append({"name": name, "action": action, "course": course,
                     "mountain": mountain, "start": start, "end": end,
                     "ranking_enabled": wants_ranking, "problems": problems})
    return plan


def _create_point(conn, mountain_id, spec, *, publish: bool):
    return conn.execute(text("""
        INSERT INTO points (code, type, status, name, mountain_id, geom)
        VALUES (:code, :type, :status, :name, :mountain,
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))
        RETURNING id, code, type, status, mountain_id, TRUE AS has_geom"""),
        {"code": spec["code"], "type": spec["type"],
         "status": "published" if publish else "draft",
         "name": spec.get("name") or spec["code"], "mountain": mountain_id,
         "lat": spec["create"]["lat"], "lng": spec["create"]["lng"]}).mappings().one()


def apply_plan(conn, plan, *, coordinates_verified: bool, dry_run: bool):
    """按计划写库；dry_run 只报告。返回 (写入条数, 报告行)。"""
    written = 0
    report = []
    for item in plan:
        if item["action"] != "write":
            report.append((item["name"], "跳过", item["problems"]))
            continue
        if dry_run:
            report.append((item["name"], "计划写入（未执行）", item["problems"]))
            continue
        course = item["course"]
        mountain_id = item["mountain"]["id"]
        endpoints = {}
        for label in ("start", "end"):
            row = item[label]
            if row.get("id"):
                endpoints[label] = row["id"]
                # 现场核实过坐标之后，之前以草稿落库的端点要跟着放行，
                # 否则扫码能用、GPS 却永远起不来。
                if coordinates_verified and row.get("has_geom") and row["status"] != "published":
                    conn.execute(text("UPDATE points SET status='published' WHERE id=:id"),
                                 {"id": row["id"]})
            else:
                endpoints[label] = _create_point(conn, mountain_id, row,
                                                 publish=coordinates_verified)["id"]
        conn.execute(text("""
            INSERT INTO ascent_courses (mountain_id, start_point_id, end_point_id,
                name, distance_m, gain_m, min_duration_s, ranking_enabled)
            VALUES (:mountain, :start, :end, :name, :distance, :gain, :floor, :ranking)
            ON CONFLICT (mountain_id, start_point_id, end_point_id, name)
            DO UPDATE SET min_duration_s = EXCLUDED.min_duration_s,
                          ranking_enabled = EXCLUDED.ranking_enabled,
                          distance_m = EXCLUDED.distance_m,
                          gain_m = EXCLUDED.gain_m"""),
            {"mountain": mountain_id, "start": endpoints["start"], "end": endpoints["end"],
             "name": item["name"], "distance": course.get("distance_m"),
             "gain": course.get("gain_m"), "floor": int(course.get("min_duration_s", 300)),
             "ranking": item["ranking_enabled"]})
        written += 1
        report.append((item["name"], "已写入（开榜：%s）" % item["ranking_enabled"],
                       item["problems"]))
    return written, report


def load_config(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main(argv=None):
    parser = argparse.ArgumentParser(description="配置 V3 试点上登路线")
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--apply", action="store_true", help="真的写库；不加就是只报告")
    parser.add_argument("--coordinates-verified", action="store_true",
                        help="确认坐标已现场核实，允许开启公开榜")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    engine = create_engine(os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://hikes:hikes@db:5432/hikes"))
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print("[pilot] %s 配置：%s" % (stamp, args.config))
    with engine.begin() as conn:
        plan = plan_courses(conn, config.get("courses", []),
                            coordinates_verified=args.coordinates_verified)
        written, report = apply_plan(conn, plan,
                                     coordinates_verified=args.coordinates_verified,
                                     dry_run=not args.apply)
    for name, action, problems in report:
        print("- %s → %s" % (name, action))
        for problem in problems:
            print("    · %s" % problem)
    print("[pilot] 写入/计划 %d 条，%s" % (written, "已落库" if args.apply else "预览模式"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
