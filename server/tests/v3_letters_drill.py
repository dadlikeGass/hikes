"""T7：私人未来信（计划 T7）。

覆盖：三种解锁模式的服务端校验、正文只在解锁后下发（封存正文不出现在任何响应里）、
目标地点与等待状态、日期模式 1/3/5 年与闰日落到二月末、checkin 只认写信之后的新到访、
离线补传入账后也算解锁、open 立即可读、read_at 只记首次、删除后不可访问、
越权一律 404、未登录 401、注销清空。
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3t7"
SHANGHAI = ZoneInfo("Asia/Shanghai")


class LettersDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))
        cls.peak = V.new_point(PREFIX, kind="peak", lat=31.2, lng=121.2,
                               mountain_id=cls.mountain)
        cls.other_peak = V.new_point(PREFIX, kind="peak", lat=31.3, lng=121.3,
                                     mountain_id=cls.mountain)

    @classmethod
    def tearDownClass(cls):
        V.purge(PREFIX)
        cls.http.close()

    def write(self, account, **body):
        return self.http.post("/api/me/letters", json=body, headers=account["headers"])

    def letters(self, account):
        return V.ok(self.http.get("/api/me/letters", headers=account["headers"]), "信箱列表")

    def read(self, account, letter_id):
        return self.http.get("/api/me/letters/%d" % letter_id, headers=account["headers"])

    def checkin(self, account, point, *, minutes_ago=5):
        at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
        return V.ok(V.checkin_account(self.http, account, point["id"], source="scan",
                                      clientUuid=V.action_uuid(), occurredAt=at), "打卡")

    # ---- 创建与校验 ----

    def test_01_create_validates_mode_specific_fields(self):
        account = V.new_account(self.http, PREFIX + "u")
        missing_years = self.write(account, text="给五年后的自己", mode="date")
        self.assertEqual(422, missing_years.status_code)
        self.assertEqual("LETTER_YEARS_REQUIRED", V.error_code(missing_years))
        missing_point = self.write(account, text="等一次登顶", mode="checkin")
        self.assertEqual(422, missing_point.status_code)
        self.assertEqual("LETTER_POINT_REQUIRED", V.error_code(missing_point))
        conflict = self.write(account, text="混搭", mode="open", years=3)
        self.assertEqual(422, conflict.status_code)
        self.assertEqual("LETTER_MODE_CONFLICT", V.error_code(conflict))
        conflict = self.write(account, text="混搭", mode="date", years=5,
                              pointId=self.peak["id"])
        self.assertEqual(422, conflict.status_code)
        empty = self.write(account, text="   ", mode="open")
        self.assertEqual(422, empty.status_code)
        too_long = self.write(account, text="字" * 2001, mode="open")
        self.assertEqual(422, too_long.status_code)
        strange_point = self.write(account, text="不存在的点", mode="checkin",
                                   pointId=99999999)
        self.assertEqual(404, strange_point.status_code)
        ok = self.write(account, text="五年后见 " + account["username"], mode="date", years=5)
        data = V.ok(ok, "写日期信")
        self.assertEqual("sealed", data["status"])
        self.assertEqual("date", data["mode"])
        self.assertNotIn("text", data, "刚封存的信不能回显正文")
        self.assertIsNotNone(data["unlockAt"])

    def test_02_date_mode_unlock_targets(self):
        account = V.new_account(self.http, PREFIX + "u")
        created = V.ok(self.write(account, text="一年后", mode="date", years=1), "一年")
        target = datetime.fromisoformat(
            created["unlockAt"].replace("Z", "+00:00")).astimezone(SHANGHAI)
        self.assertEqual(1, target.year - datetime.now(SHANGHAI).year)
        self.assertEqual((0, 0, 0), (target.hour, target.minute, target.second),
                         "解锁时刻是当地零点")
        three = V.ok(self.write(account, text="三年后", mode="date", years=3), "三年")
        five = V.ok(self.write(account, text="五年后", mode="date", years=5), "五年")
        # 闰日：2 月 29 日写的信，落到目标年的 2 月末
        leap = V.sql_one("""SELECT (TIMESTAMPTZ '2024-02-29 12:00:00+08' + interval '1 year')
            AT TIME ZONE 'Asia/Shanghai'""")
        self.assertEqual("2025-02-28 12:00:00", leap[0],
                         "先确认数据库层面的闰日行为：Postgres 把 2/29+1 年落到 2 月末")
        # 服务端用的是 replace(year=...)：闰日会抛 ValueError，落回 2 月 28 日
        source = open(os.path.join(V.REPO_ROOT, "server", "app", "main.py"),
                      encoding="utf-8").read()
        self.assertIn('target = local.replace(year=local.year + body.years, day=28)', source,
                      "闰日必须落回目标年的 2 月末，而不是抛 500")
        self.assertGreater(len(three["unlockAt"]), 0)
        self.assertGreater(len(five["unlockAt"]), 0)

    # ---- 列表与读取 ----

    def test_03_sealed_body_never_leaks(self):
        account = V.new_account(self.http, PREFIX + "u")
        secret = "封存正文不许出现-" + account["username"]
        letter = V.ok(self.write(account, text=secret, mode="date", years=5), "写封存信")
        listing = self.letters(account)
        self.assertEqual(1, len(listing))
        self.assertEqual({"id", "mode", "pointId", "pointCode", "pointName", "status",
                          "unlockAt", "createdAt"}, set(listing[0]))
        self.assertEqual("sealed", listing[0]["status"])
        self.assertNotIn(secret, self.http.get("/api/me/letters",
                                              headers=account["headers"]).text)
        read = self.read(account, letter["id"])
        self.assertEqual(200, read.status_code)
        self.assertNotIn(secret, read.text, "未解锁的正文不能下发")
        self.assertEqual("sealed", read.json()["status"])
        self.assertIsNone(V.sql_value("SELECT read_at FROM letters WHERE id=%d"
                                      % letter["id"]),
                          "没读过就不该写 read_at")

    def test_04_open_mode_is_readable_and_records_first_read(self):
        account = V.new_account(self.http, PREFIX + "u")
        text = "随时可看的信 " + account["username"]
        letter = V.ok(self.write(account, text=text, mode="open"), "写 open 信")
        self.assertEqual("unlocked", letter["status"])
        self.assertEqual(text, letter["text"])
        first = self.read(account, letter["id"])
        self.assertEqual(text, first.json()["text"])
        self.assertIsNotNone(V.sql_value("SELECT read_at FROM letters WHERE id=%d"
                                        % letter["id"]))
        # 把首次阅读时间往前挪一天，再读一次：read_at 必须还是那天的值
        V.sql("UPDATE letters SET read_at = read_at - interval '1 day' WHERE id=%d"
              % letter["id"])
        backdated = V.sql_value("SELECT read_at FROM letters WHERE id=%d" % letter["id"])
        self.read(account, letter["id"])
        self.assertEqual(backdated, V.sql_value("SELECT read_at FROM letters WHERE id=%d"
                                               % letter["id"]),
                         "read_at 只记第一次阅读，重复打开不刷新")

    # ---- checkin 解锁 ----

    def test_05_checkin_unlock_requires_new_visit_after_writing(self):
        account = V.new_account(self.http, PREFIX + "u")
        # 三天前来过这里（正常打卡，现场时间就是三天前）
        self.checkin(account, self.peak, minutes_ago=3 * 24 * 60)
        letter = V.ok(self.write(account, text="等到你再来这里", mode="checkin",
                                 pointId=self.peak["id"]), "写 checkin 信")
        listing = self.letters(account)
        self.assertEqual("sealed", listing[0]["status"])
        self.assertEqual(self.peak["code"], listing[0]["pointCode"],
                         "封存时要显示等在哪个地点")
        sealed = self.read(account, letter["id"])
        self.assertEqual("sealed", sealed.json()["status"], "写信之前的到访不能解锁")
        self.assertNotIn("等到你再来这里", sealed.text)

        # 换一个点位打卡也不解锁
        self.checkin(account, self.other_peak, minutes_ago=1)
        self.assertEqual("sealed", self.read(account, letter["id"]).json()["status"])

        # 同一天重复扫码拿到的还是三天前那条到访（一天一条），所以还是封存
        self.checkin(account, self.peak, minutes_ago=3 * 24 * 60)
        self.assertEqual(1, V.sql_int("""SELECT count(*) FROM visits
            WHERE user_id=%d AND point_id=%d""" % (account["uid"], self.peak["id"])),
            "同一天同一点只记一条")
        self.assertEqual("sealed", self.read(account, letter["id"]).json()["status"],
                         "重复提交不产生新到访，自然也不解锁")

        # 把写信时间往前挪一分钟，再用"现在"的现场时间打卡 → 新的到访，解锁
        V.sql("UPDATE letters SET created_at = created_at - interval '1 minute' WHERE id=%d"
              % letter["id"])
        self.checkin(account, self.peak, minutes_ago=0)
        unlocked = self.read(account, letter["id"])
        self.assertEqual("unlocked", unlocked.json()["status"])
        self.assertEqual("等到你再来这里", unlocked.json()["text"])

    def test_06_offline_verified_visit_unlocks_after_sync(self):
        """离线记录：服务器验证入账、且现场时间晚于写信时间，才算解锁。"""
        account = V.new_account(self.http, PREFIX + "u")
        letter = V.ok(self.write(account, text="离线也要算数", mode="checkin",
                                 pointId=self.peak["id"]), "写 checkin 信")
        V.sql("UPDATE letters SET created_at = created_at - interval '2 days' WHERE id=%d"
              % letter["id"])
        self.assertEqual("sealed", self.read(account, letter["id"]).json()["status"],
                         "还没入账的到访不算数")
        # 现场时间早于写信时间：即使补传入账也不解锁
        self.checkin(account, self.peak, minutes_ago=3 * 24 * 60)
        self.assertEqual("sealed", self.read(account, letter["id"]).json()["status"],
                         "现场时间仍在写信之前，不算新到访")
        # 现场时间在写信之后、稍后补传：入账即解锁
        self.checkin(account, self.peak, minutes_ago=1 * 24 * 60)
        self.assertEqual("unlocked", self.read(account, letter["id"]).json()["status"],
                         "有效到访入账之后就该解锁，不需要等定时任务")

    # ---- 权限与删除 ----

    def test_07_cross_account_access_is_404(self):
        owner = V.new_account(self.http, PREFIX + "u")
        intruder = V.new_account(self.http, PREFIX + "u")
        letter = V.ok(self.write(owner, text="只有我能看 " + owner["username"],
                                 mode="open"), "写信")
        self.assertEqual(404, self.read(intruder, letter["id"]).status_code)
        self.assertEqual(404, self.http.delete("/api/me/letters/%d" % letter["id"],
                                              headers=intruder["headers"]).status_code)
        self.assertEqual(401, self.http.get("/api/me/letters").status_code)
        self.assertEqual(401, self.http.get("/api/me/letters/%d" % letter["id"]).status_code)
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM letters WHERE id=%d"
                                      % letter["id"]), "越权删除不能真的删掉")
        # 列表里也不该混进别人的信
        self.assertEqual([], self.letters(intruder))

    def test_08_delete_removes_letter_and_sealed_ones_too(self):
        account = V.new_account(self.http, PREFIX + "u")
        sealed = V.ok(self.write(account, text="封存也要能删", mode="date", years=5),
                      "写封存信")
        V.ok(self.http.delete("/api/me/letters/%d" % sealed["id"],
                             headers=account["headers"]), "删除封存信")
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM letters WHERE id=%d"
                                      % sealed["id"]))
        self.assertEqual(404, self.read(account, sealed["id"]).status_code)
        self.assertEqual([], self.letters(account))
        self.assertEqual(404, self.http.delete("/api/me/letters/%d" % sealed["id"],
                                              headers=account["headers"]).status_code)

    def test_09_mode_cannot_be_changed_to_bypass_sealing(self):
        account = V.new_account(self.http, PREFIX + "u")
        letter = V.ok(self.write(account, text="不许改模式偷看 " + account["username"],
                                 mode="date", years=5), "写封存信")
        patched = self.http.patch("/api/me/letters/%d" % letter["id"],
                                  json={"mode": "open"}, headers=account["headers"])
        self.assertIn(patched.status_code, (404, 405),
                      "没有改模式这个入口，封存不能被绕过")
        self.assertEqual("date", V.sql_value("SELECT unlock_mode FROM letters WHERE id=%d"
                                            % letter["id"]))
        self.assertEqual("sealed", V.sql_value("""SELECT status FROM letters WHERE id=%d"""
                                               % letter["id"]))
        self.assertNotIn("不许改模式偷看", self.read(account, letter["id"]).text)

    def test_10_legacy_date_letters_are_sealed_until_due(self):
        """迁移前写下的信（只有 unlock_at 日期）按上海零点转换后仍然生效。"""
        account = V.new_account(self.http, PREFIX + "u")
        V.sql("""INSERT INTO letters (user_id, text, unlock_mode, unlock_at)
            VALUES (%d, '旧表里写的信', 'date',
                    (TIMESTAMPTZ '2027-01-01 00:00:00+08'))""" % account["uid"])
        listing = self.letters(account)
        self.assertEqual("sealed", listing[0]["status"])
        self.assertNotIn("旧表里写的信", self.http.get("/api/me/letters",
                                                     headers=account["headers"]).text)
        V.sql("""UPDATE letters SET unlock_at = now() - interval '1 minute'
            WHERE user_id=%d""" % account["uid"])
        self.assertEqual("旧表里写的信", self.letters(account)[0]["text"],
                         "到期后自动可读")


if __name__ == "__main__":
    unittest.main()
