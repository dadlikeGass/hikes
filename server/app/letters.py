"""Private letter unlock checks; never return sealed body text."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text


def letter_is_unlocked(conn, letter) -> bool:
    if letter["unlock_mode"] == "open":
        return True
    if letter["unlock_mode"] == "date":
        return letter["unlock_at"] is not None and letter["unlock_at"] <= datetime.now(timezone.utc)
    return bool(conn.execute(text("""SELECT 1 FROM visits
        WHERE user_id=:user AND point_id=:point AND occurred_at > :written
        LIMIT 1"""), {"user": letter["user_id"], "point": letter["point_id"],
                     "written": letter["created_at"]}).scalar_one_or_none())


def public_letter(conn, letter, *, include_text: bool) -> dict:
    """对外形状：未解锁只给"封存中 + 解锁条件"，正文一律不下发。

    checkin 模式必须能显示"在哪个地点等一次新到访"，否则页面上只剩一句
    "等待打卡"，用户不知道等的是哪里（计划 3.5）。
    """
    unlocked = letter_is_unlocked(conn, letter)
    place = None
    if letter["point_id"] is not None:
        place = conn.execute(text("""SELECT code, name FROM points WHERE id=:id"""),
                             {"id": letter["point_id"]}).mappings().first()
    result = {"id": letter["id"], "mode": letter["unlock_mode"],
              "pointId": letter["point_id"],
              "pointCode": place["code"] if place else None,
              "pointName": place["name"] if place else None,
              "status": "unlocked" if unlocked else "sealed",
              "unlockAt": letter["unlock_at"], "createdAt": letter["created_at"]}
    if include_text and unlocked:
        result["text"] = letter["text"]
    return result
