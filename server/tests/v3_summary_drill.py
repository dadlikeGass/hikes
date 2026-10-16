"""T6：凭证列表与山级摘要的服务端部分（计划 T6）。

覆盖：凭证形状（地点 / 序号 / 时间 / 用时 / 资格原因）、按时间倒序、游标翻页不漏不重、
limit 上限 50；山级摘要按 mountain_id 聚合（同山两码只一条）、人数按身份去重
（重复到访不涨人数）、游客只看自己到过的山、没有 mountain_id 的点位不进山级汇总、
无记录时返回空数组而不是报错、未登录一律 401。

页面布局与 390px/1440px 的真机效果在 server/tests/v3_browser_checklist.md 里核对。
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3t6"


class SummaryDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)

    @classmethod
    def tearDownClass(cls):
        V.purge(PREFIX)
        cls.http.close()

    def mountain_pair(self, tag):
        """一座山 + 两个带坐标的点位（同山两码），返回 (mountain_id, [point, point])。"""
        mountain = V.new_mountain(PREFIX, V.unique(PREFIX + tag))
        first = V.new_point(PREFIX, kind="peak", lat=30.0, lng=120.0, mountain_id=mountain)
        second = V.new_point(PREFIX, kind="junction", lat=30.01, lng=120.01,
                             mountain_id=mountain)
        return mountain, [first, second]

    def checkin(self, identity, point, *, minutes_ago, guest=False, client_uuid=None):
        at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
        if guest:
            response = V.checkin_guest(self.http, identity, point["code"], source="scan",
                                       clientUuid=client_uuid or V.action_uuid(),
                                       occurredAt=at)
        else:
            response = V.checkin_account(self.http, identity, point["id"], source="scan",
                                         clientUuid=client_uuid or V.action_uuid(),
                                         occurredAt=at)
        return V.ok(response, "打卡")

    # ---- 凭证 ----

    def test_01_receipt_shape_and_order(self):
        mountain, (peak, junction) = self.mountain_pair("shan")
        account = V.new_account(self.http, PREFIX + "u")
        self.checkin(account, junction, minutes_ago=180)
        self.checkin(account, peak, minutes_ago=60)
        rows = V.ok(self.http.get("/api/me/visit-receipts",
                                 headers=account["headers"]), "我的凭证")
        self.assertEqual(2, len(rows))
        self.assertEqual({"visitId", "code", "name", "kind", "seq", "visitedAt",
                          "recordedAt", "durationS", "effortReason"}, set(rows[0]))
        self.assertEqual(peak["code"], rows[0]["code"], "最近的到访排在最前")
        self.assertTrue(rows[0]["visitedAt"] > rows[1]["visitedAt"])
        for row in rows:
            self.assertEqual(mountain, V.sql_int(
                "SELECT mountain_id FROM points WHERE id=(SELECT point_id FROM visits "
                "WHERE id=%d)" % row["visitId"]))
        # 没有精确坐标字段
        self.assertFalse(any("lat" in key.lower() or "accuracy" in key.lower() for key in rows[0]))

    def test_02_receipt_cursor_pages_without_gaps(self):
        # 同一天同一个人同一个点位只会有一条到访，所以这里用五个不同点位来造五条凭证；
        # 前两条故意落在同一分钟，验证游标按 (occurred_at, id) 断点而不是只按时间。
        mountain, _ = self.mountain_pair("shan")
        points = [V.new_point(PREFIX, kind="peak", lat=30.0 + i * 0.01, lng=120.0,
                              mountain_id=mountain) for i in range(5)]
        account = V.new_account(self.http, PREFIX + "u")
        total = len(points)
        for index, point in enumerate(points):
            minutes = 30 if index < 2 else 30 + index * 10
            self.checkin(account, point, minutes_ago=minutes)
        first_page = V.ok(self.http.get("/api/me/visit-receipts?limit=3",
                                       headers=account["headers"]), "第一页")
        self.assertEqual(3, len(first_page))
        second_page = V.ok(self.http.get("/api/me/visit-receipts?limit=3&cursor=%d"
                                        % first_page[-1]["visitId"],
                                        headers=account["headers"]), "第二页")
        ids = [row["visitId"] for row in first_page + second_page]
        self.assertEqual(len(ids), len(set(ids)), "翻页不能重复")
        self.assertEqual(total, len(ids), "翻页不能漏")
        # limit 上限 50
        capped = V.ok(self.http.get("/api/me/visit-receipts?limit=999",
                                    headers=account["headers"]), "超大 limit")
        self.assertLessEqual(len(capped), 50)

    def test_03_guest_receipts_are_own_records_only(self):
        mountain, (peak, _) = self.mountain_pair("shan")
        guest = V.new_guest(self.http, PREFIX + "g")
        other = V.new_guest(self.http, PREFIX + "g")
        self.checkin(guest, peak, minutes_ago=30, guest=True)
        self.checkin(other, peak, minutes_ago=20, guest=True)
        mine = V.ok(self.http.get("/api/guest/visit-receipts", headers=guest["headers"]),
                    "游客户凭证")
        self.assertEqual(1, len(mine))
        self.assertEqual("guest", V.sql_value(
            "SELECT CASE WHEN guest_id IS NULL THEN 'user' ELSE 'guest' END FROM visits "
            "WHERE id=%d" % mine[0]["visitId"]))

    # ---- 山级摘要 ----

    def test_04_same_mountain_two_codes_is_one_row(self):
        mountain, (peak, junction) = self.mountain_pair("shan")
        account = V.new_account(self.http, PREFIX + "u")
        self.checkin(account, junction, minutes_ago=200)
        self.checkin(account, peak, minutes_ago=100)
        rows = V.ok(self.http.get("/api/me/mountain-summary?limit=10",
                                 headers=account["headers"]), "山级摘要")
        mine = [row for row in rows if row["mountainId"] == mountain]
        self.assertEqual(1, len(mine), "同一座山的两个码只算一座山")
        self.assertEqual(1, mine[0]["visitorCount"], "重复到访不涨人数")
        self.assertEqual({"mountainId", "name", "visitorCount", "myLastVisitedAt"},
                         set(mine[0]))

    def test_05_visitor_count_dedupes_identities(self):
        mountain, (peak, _) = self.mountain_pair("shan")
        account = V.new_account(self.http, PREFIX + "u")
        guest = V.new_guest(self.http, PREFIX + "g")
        self.checkin(account, peak, minutes_ago=300)
        self.checkin(guest, peak, minutes_ago=200, guest=True)
        # 同一个人再来一次（同点位同日被去重，换个日子再来一次）
        V.sql("""INSERT INTO visits (user_id, point_id, seq, visit_date, source, occurred_at,
            recorded_at, evidence_level)
            VALUES (%d, %d, (SELECT coalesce(max(seq),0)+1 FROM visits WHERE point_id=%d),
            CURRENT_DATE - 3, 'scan', now() - interval '3 days', now(), 'code')"""
            % (account["uid"], peak["id"], peak["id"]))
        rows = V.ok(self.http.get("/api/me/mountain-summary?limit=10",
                                 headers=account["headers"]), "山级摘要")
        mine = [row for row in rows if row["mountainId"] == mountain][0]
        self.assertEqual(2, mine["visitorCount"], "人数按身份去重：一个账号 + 一个游客")

    def test_06_guest_summary_only_lists_visited_mountains(self):
        visited, (peak, _) = self.mountain_pair("shan")
        other_mountain, (other_peak, _) = self.mountain_pair("shan")
        guest = V.new_guest(self.http, PREFIX + "g")
        self.checkin(guest, peak, minutes_ago=100, guest=True)
        rows = V.ok(self.http.get("/api/guest/mountain-summary",
                                 headers=guest["headers"]), "游客户摘要")
        ids = {row["mountainId"] for row in rows}
        self.assertIn(visited, ids)
        self.assertNotIn(other_mountain, ids, "没到过的山不能出现在我的摘要里")

    def test_07_unlinked_points_do_not_enter_mountain_summary(self):
        mountain, (peak, _) = self.mountain_pair("shan")
        orphan = V.new_point(PREFIX, kind="peak", lat=30.5, lng=120.5)   # 没有 mountain_id
        account = V.new_account(self.http, PREFIX + "u")
        self.checkin(account, orphan, minutes_ago=50)
        rows = V.ok(self.http.get("/api/me/mountain-summary?limit=10",
                                 headers=account["headers"]), "山级摘要")
        self.assertEqual([], rows, "没有山峰归属的点位不塞进山级汇总")

    def test_08_empty_and_unauthorized_paths(self):
        account = V.new_account(self.http, PREFIX + "u")
        self.assertEqual([], V.ok(self.http.get("/api/me/visit-receipts",
                                               headers=account["headers"]), "空凭证"))
        self.assertEqual([], V.ok(self.http.get("/api/me/mountain-summary",
                                               headers=account["headers"]), "空摘要"))
        for path in ("/api/me/visit-receipts", "/api/me/mountain-summary"):
            self.assertEqual(401, self.http.get(path).status_code,
                             "%s 未登录必须 401" % path)
        self.assertEqual(401, self.http.get("/api/guest/mountain-summary",
                                           headers={"X-Guest-Token": "0" * 48}).status_code)

    def test_09_limit_is_bounded_and_sorted_by_recency(self):
        peaks = []
        for index in range(4):
            mountain, (peak, _) = self.mountain_pair("shan")
            peaks.append((mountain, peak))
        account = V.new_account(self.http, PREFIX + "u")
        for index, (_, peak) in enumerate(peaks):
            self.checkin(account, peak, minutes_ago=100 - index * 10)
        rows = V.ok(self.http.get("/api/me/mountain-summary?limit=3",
                                 headers=account["headers"]), "只要三座山")
        self.assertEqual(3, len(rows), "首页默认最多三座山")
        self.assertEqual(peaks[-1][0], rows[0]["mountainId"], "最近到访的山排最前")
        self.assertEqual(4, len(V.ok(self.http.get("/api/me/mountain-summary?limit=10",
                                                  headers=account["headers"]),
                                    "查看全部")))


if __name__ == "__main__":
    unittest.main()
