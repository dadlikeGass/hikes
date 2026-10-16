"""首页两个榜（位次榜 / 打卡人数榜）与占山为王登顶榜的服务端验收。

覆盖：人数与人次是两个口径、窗口切分（上海时区、周一为周起点）、身份去重
（同一人重复到访不涨人数）、游客与账号都算独立身份、榜单只公开昵称与计数、
没有山峰归属的点位不进榜、登录时能看到自己的位次且过期令牌只丢"我的位次"。
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3t8"
SHANGHAI = ZoneInfo("Asia/Shanghai")


class BoardsDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))
        cls.other_mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))
        cls.peak = V.new_point(PREFIX, kind="peak", lat=30.0, lng=120.0,
                               mountain_id=cls.mountain, name="榜单演练峰")
        cls.other_peak = V.new_point(PREFIX, kind="peak", lat=30.5, lng=120.5,
                                     mountain_id=cls.other_mountain, name="榜单演练另一峰")
        cls.orphan = V.new_point(PREFIX, kind="peak", lat=31.0, lng=121.0)   # 没有山

    @classmethod
    def tearDownClass(cls):
        V.purge(PREFIX)
        cls.http.close()

    def visit(self, identity, point, *, minutes_ago, guest=False):
        at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
        if guest:
            return V.ok(V.checkin_guest(self.http, identity, point["code"], source="scan",
                                        clientUuid=V.action_uuid(), occurredAt=at), "游客打卡")
        return V.ok(V.checkin_account(self.http, identity, point["id"], source="scan",
                                      clientUuid=V.action_uuid(), occurredAt=at), "账号打卡")

    def test_01_people_and_visits_are_different_metrics(self):
        """同一个人多次到访：人次涨、人数不涨。两个榜的口径必须分开。"""
        account = V.new_account(self.http, PREFIX + "u")
        # 同一天同一点只有一条记录，所以用不同点位/不同天造"多次"
        V.sql("""INSERT INTO visits (user_id, point_id, seq, visit_date, source,
            occurred_at, recorded_at, evidence_level)
            VALUES (%d, %d, (SELECT coalesce(max(seq),0)+1 FROM visits WHERE point_id=%d),
            CURRENT_DATE - 2, 'scan', now() - interval '2 days', now(), 'code'),
            (%d, %d, (SELECT coalesce(max(seq),0)+2 FROM visits WHERE point_id=%d),
            CURRENT_DATE - 1, 'scan', now() - interval '1 day', now(), 'code')"""
            % (account["uid"], self.peak["id"], self.peak["id"],
               account["uid"], self.peak["id"], self.peak["id"]))
        guest = V.new_guest(self.http, PREFIX + "g")
        self.visit(guest, self.peak, minutes_ago=30, guest=True)
        people = V.ok(self.http.get("/api/boards/mountains?window=week&metric=people&limit=10"),
                      "打卡人数榜")
        visits = V.ok(self.http.get("/api/boards/mountains?window=week&metric=visits&limit=10"),
                      "登顶榜")
        mine_people = [row for row in people["items"] if row["mountainId"] == self.mountain][0]
        mine_visits = [row for row in visits["items"] if row["mountainId"] == self.mountain][0]
        self.assertEqual(2, mine_people["people"], "去重身份数：1 个账号 + 1 个游客")
        self.assertEqual(3, mine_visits["visits"], "人次：账号 2 次 + 游客 1 次")
        self.assertEqual(self.peak["code"], mine_people["pointCode"],
                         "榜上要能点进具体点位")

    def test_02_window_and_week_start(self):
        account = V.new_account(self.http, PREFIX + "u")
        # 上周的记录：不进"本周"，进"历史"
        monday = datetime.now(SHANGHAI).replace(hour=0, minute=0, second=0, microsecond=0) \
            - timedelta(days=datetime.now(SHANGHAI).weekday())
        last_week = monday - timedelta(days=3, hours=1)
        V.sql("""INSERT INTO visits (user_id, point_id, seq, visit_date, source, occurred_at,
            recorded_at, evidence_level)
            VALUES (%d, %d, (SELECT coalesce(max(seq),0)+1 FROM visits WHERE point_id=%d),
            DATE '%s', 'scan', TIMESTAMPTZ '%s', now(), 'code')"""
            % (account["uid"], self.other_peak["id"], self.other_peak["id"],
               last_week.astimezone(SHANGHAI).date(), last_week.isoformat()))
        week = V.ok(self.http.get("/api/boards/mountains?window=week&metric=people&limit=50"),
                    "本周")
        history = V.ok(self.http.get("/api/boards/mountains?window=all&metric=people&limit=50"),
                       "历史")
        self.assertNotIn(self.other_mountain,
                         [row["mountainId"] for row in week["items"]],
                         "上周的记录不该出现在本周")
        self.assertIn(self.other_mountain,
                      [row["mountainId"] for row in history["items"]])

    def test_03_points_without_mountain_are_excluded(self):
        account = V.new_account(self.http, PREFIX + "u")
        self.visit(account, self.orphan, minutes_ago=20)
        rows = V.ok(self.http.get("/api/boards/mountains?window=week&limit=50"), "山头榜")
        codes = [row["pointCode"] for row in rows["items"]]
        self.assertNotIn(self.orphan["code"], codes, "没有山峰归属的点位不进山头榜")

    def test_04_climbers_rank_and_my_position(self):
        """位次榜按"登过几座山"排；登录时能看到自己的位次。"""
        climber = V.new_account(self.http, PREFIX + "u")
        for point in (self.peak, self.other_peak):
            self.visit(climber, point, minutes_ago=45)
        me = V.new_account(self.http, PREFIX + "u")
        self.visit(me, self.peak, minutes_ago=25)
        board = V.ok(self.http.get("/api/boards/climbers?window=week&limit=50",
                                  headers=me["headers"]), "位次榜")
        names = [row["nickname"] for row in board["items"]]
        self.assertIn(climber["nickname"], names, "登了两座山的人要出现在榜上")
        self.assertIsNotNone(board["mine"], "登录后要有我的位次")
        self.assertEqual(1, board["mine"]["summits"])
        rows = [row for row in board["items"] if row["rank"] == board["mine"]["rank"]]
        self.assertEqual(1, len(rows))
        self.assertTrue(all("nickname" in row and "summits" in row and "visits" in row
                            for row in board["items"]))
        raw = self.http.get("/api/boards/climbers?window=week", headers=me["headers"]).text
        for leak in ("uid", "guest_id", "lat", "lng", "accuracy"):
            self.assertNotIn(leak, raw, "榜单不能泄露身份标识或坐标")

    def test_05_stale_token_only_loses_my_rank(self):
        bad = {"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiZXhwIjoxfQ.x"}
        response = self.http.get("/api/boards/climbers?window=week", headers=bad)
        self.assertEqual(200, response.status_code, "过期令牌不该让榜单整页报错")
        self.assertIsNone(response.json()["mine"])
        mountains = self.http.get("/api/boards/mountains?window=week", headers=bad)
        self.assertEqual(200, mountains.status_code)

    def test_06_limits_and_shapes(self):
        rows = V.ok(self.http.get("/api/boards/mountains?window=week&limit=1"), "limit=1")
        self.assertLessEqual(len(rows["items"]), 1)
        self.assertEqual({"window", "metric", "items"}, set(rows))
        # 榜上还带热度档与年接待量（"按热门"口径要用），字段形状一起钉住
        self.assertEqual({"mountainId", "name", "pointCode", "visits", "people",
                          "heatTier", "annualVisits"}, set(rows["items"][0]))
        board = V.ok(self.http.get("/api/boards/climbers?window=week"), "位次榜形状")
        self.assertEqual({"window", "sampleSize", "items", "mine"}, set(board))


if __name__ == "__main__":
    unittest.main()
