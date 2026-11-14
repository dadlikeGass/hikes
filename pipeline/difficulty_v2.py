"""方向化分段难度 V2 的纯计算域。

输入只使用已经完成的 route products；本模块不读写数据库，也不发布结果。
"""
from __future__ import annotations

import hashlib
import math
from typing import Any

MODEL_VERSION = "log_v1"
SEGMENTATION_VERSION = "terrain_segment_v1"
E_P99 = 5257.908
LOG_SCALE_M = 300.0

GRADES = (
    (90.0, "extreme", "极度困难"),
    (75.0, "hard_plus", "困难+"),
    (60.0, "hard", "困难"),
    (48.0, "moderate_plus", "中等+"),
    (34.0, "moderate", "中等"),
    (24.0, "general_plus", "一般+"),
    (0.0, "general", "一般"),
)


def grade_for_score(score: float) -> dict[str, str]:
    for floor, key, label in GRADES:
        if score >= floor:
            return {"key": key, "label": label}
    raise AssertionError("grade table must cover zero")


def _score(ascent_m: float, descent_m: float, distance_km: float) -> float:
    equivalent = ascent_m + 0.4 * descent_m + 8.0 * distance_km
    return 100.0 * math.log1p(equivalent / LOG_SCALE_M) / math.log1p(E_P99 / LOG_SCALE_M)


def _segment_key(slug: str, segment: dict[str, Any]) -> str:
    identity = (f"{SEGMENTATION_VERSION}:{slug}:"
                f"{float(segment['from']):.3f}-{float(segment['to']):.3f}")
    return "segv2_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]


def score_segment(segment: dict[str, Any], direction: str) -> dict[str, Any]:
    if direction not in {"forward", "reverse"}:
        raise ValueError("direction must be forward or reverse")
    forward = direction == "forward"
    ascent = int(segment.get("up_m", 0) if forward else segment.get("down_m", 0))
    descent = int(segment.get("down_m", 0) if forward else segment.get("up_m", 0))
    score = _score(ascent, descent, float(segment["km"]))
    return {
        "direction": direction,
        "ascentM": ascent,
        "descentM": descent,
        "distanceKm": round(float(segment["km"]), 3),
        "internalScore": round(score, 6),
        "baseGrade": grade_for_score(score),
        "max100mAscentM": segment.get("max_100m_up_m"),
        "max100mDescentM": segment.get("max_100m_down_m"),
    }


def directional_results(slug: str, route: dict[str, Any]) -> list[dict[str, Any]]:
    segments = route.get("segments") or []
    total = len(segments)
    return [{
        "segmentKey": _segment_key(slug, segment),
        "segmentationVersion": SEGMENTATION_VERSION,
        "modelVersion": MODEL_VERSION,
        "forwardOrder": index,
        "reverseOrder": total - index + 1,
        "fromKm": round(float(segment["from"]), 3),
        "toKm": round(float(segment["to"]), 3),
        "directions": {
            "forward": score_segment(segment, "forward"),
            "reverse": score_segment(segment, "reverse"),
        },
    } for index, segment in enumerate(segments, 1)]


def validate_segment_cover(route: dict[str, Any], tolerance_km: float = 0.02) -> list[str]:
    errors: list[str] = []
    segments = route.get("segments") or []
    if not segments:
        return ["route has no segments"]
    if abs(float(segments[0]["from"])) > tolerance_km:
        errors.append("first segment does not start at zero")
    for left, right in zip(segments, segments[1:]):
        gap = float(right["from"]) - float(left["to"])
        if abs(gap) > tolerance_km:
            errors.append(f"segment boundary gap/overlap: {gap:.3f} km")
    # routes.km 是对外展示的名义里程；覆盖完整性以轨迹分段自身为准。
    covered_km = sum(float(segment["to"]) - float(segment["from"])
                     for segment in segments)
    if abs(covered_km - float(segments[-1]["to"])) > tolerance_km:
        errors.append("segments do not cover the full track")
    for segment in segments:
        if float(segment["to"]) <= float(segment["from"]):
            errors.append("segment has non-positive length")
    return errors
