"""T2：统一在线打卡与身份合并（计划 T2）。

覆盖：两个旧打卡接口共用同一套规则、并发重试只落一条、同一 UUID 改内容返回 409、
现场时间按 Asia/Shanghai 归属业务日、游客注册合并后重试仍回到同一条 canonical 记录、
合并遇到账号已有同日记录时不悬空、注销清掉新增的私人数据。
"""
from __future__ import annotations

import os
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3t2"
SHANGHAI = ZoneInfo("Asia/Shanghai")


class CheckinDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))

    def pair(self, *, with_course: bool = False):
        """每个用例自己造一对起终点：共用点位会让"只落一条"这类断言互相干扰。"""
        start = V.new_point(PREFIX, kind="trailhead", lat=39.95, lng=116.10,
                            mountain_id=self.mountain)
        peak = V.new_point(PREFIX, kind="peak", lat=39.99107, lng=116.1723,
                           mountain_id=self.mountain)
        course = None
        if with_course:
            course = V.new_course(PREFIX, self.mountain, start["id"], peak["id"],
                                  ranking_enabled=True, min_duration_s=600)
        return start, peak, course

    @classmethod
    def tearDownClass(cls):
        V.purge(PREFIX)
        cls.http.close()

    # ---- 幂等与并发 ----

    def test_01_concurrent_same_uuid_lands_one_row(self):
        """同一个动作 UUID 打 20 次（并发）：只能有一条到访、一份凭证。"""
        guest = V.new_guest(self.http, PREFIX + "g")
        _, peak, _ = self.pair()
        action = V.action_uuid()
        now = datetime.now(timezone.utc) - timedelta(minutes=5)
        body = {"source": "scan", "clientUuid": action, "occurredAt": now.isoformat()}

        with V.client() as pool:
            def fire(_):
                return pool.post("/api/guest/visit",
                                 json=dict(body, code=peak["code"]),
                                 headers=guest["headers"])
            with ThreadPoolExecutor(max_workers=10) as workers:
                responses = list(workers.map(fire, range(20)))

        codes = sorted({r.status_code for r in responses})
        self.assertEqual([200], codes, "并发重试不应该出现 5xx：%s"
                         % [(r.status_code, r.text[:120]) for r in responses
                            if r.status_code != 200][:3])
        visit_ids = {r.json()["visitId"] for r in responses}
        seqs = {r.json()["seq"] for r in responses}
        self.assertEqual(1, len(visit_ids), "20 次重试必须回到同一条凭证：%s" % visit_ids)
        self.assertEqual(1, len(seqs))
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                      % peak["id"]))
        self.assertEqual(1, V.sql_int("""SELECT count(*) FROM visit_submission_receipts
            WHERE client_uuid='%s'""" % action))

    def test_02_concurrent_different_uuid_same_day_lands_one_row(self):
        """同一天同一身份同一点、20 个不同 UUID 并发：只落一条，且序号不撞。"""
        guest = V.new_guest(self.http, PREFIX + "g")
        start, _, _ = self.pair()
        now = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        with V.client() as pool:
            def fire(index):
                return pool.post("/api/guest/visit",
                                 json={"code": start["code"], "source": "scan",
                                       "clientUuid": V.action_uuid(), "occurredAt": now},
                                 headers=guest["headers"])
            with ThreadPoolExecutor(max_workers=10) as workers:
                responses = list(workers.map(fire, range(20)))
        self.assertEqual([200], sorted({r.status_code for r in responses}),
                         "并发不同 UUID 也必须全部成功：%s"
                         % [(r.status_code, r.text[:120]) for r in responses
                            if r.status_code != 200][:3])
        self.assertEqual(1, len({r.json()["visitId"] for r in responses}))
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE guest_id=%d AND point_id=%d"
                                      % (guest["id"], start["id"])))
        # 序号仍要唯一（点位内不撞号），重复提交不额外发号
        self.assertEqual(0, V.sql_int("""SELECT count(*) FROM (
            SELECT seq FROM visits WHERE point_id=%d GROUP BY seq HAVING count(*) > 1) t"""
            % start["id"]), "点位内不允许出现重复序号")

    def test_03_same_uuid_different_payload_is_409(self):
        guest = V.new_guest(self.http, PREFIX + "g")
        _, peak, _ = self.pair()
        action = V.action_uuid()
        at = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
        first = V.checkin_guest(self.http, guest, peak["code"], source="scan",
                                clientUuid=action, occurredAt=at)
        V.ok(first, "首次打卡")
        changed = V.checkin_guest(self.http, guest, peak["code"], source="manual",
                                  clientUuid=action, occurredAt=at)
        self.assertEqual(409, changed.status_code)
        self.assertEqual("CLIENT_UUID_REUSED", V.error_code(changed))
        same = V.checkin_guest(self.http, guest, peak["code"], source="scan",
                               clientUuid=action, occurredAt=at)
        self.assertEqual(200, same.status_code)
        self.assertEqual(first.json()["visitId"], same.json()["visitId"])

    def test_04_future_and_ancient_times_are_rejected(self):
        guest = V.new_guest(self.http, PREFIX + "g")
        _, peak, _ = self.pair()
        future = V.checkin_guest(self.http, guest, peak["code"], source="scan",
                                 clientUuid=V.action_uuid(),
                                 occurredAt=(datetime.now(timezone.utc)
                                             + timedelta(minutes=30)).isoformat())
        self.assertEqual(422, future.status_code)
        self.assertEqual("VISIT_TIME_IN_FUTURE", V.error_code(future))
        ancient = V.checkin_guest(self.http, guest, peak["code"], source="scan",
                                  clientUuid=V.action_uuid(),
                                  occurredAt=(datetime.now(timezone.utc)
                                              - timedelta(days=45)).isoformat())
        self.assertEqual(422, ancient.status_code)
        self.assertEqual("VISIT_TOO_OLD", V.error_code(ancient))
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                      % peak["id"]),
                         "被拒的打卡绝不能留下到访")

    def test_05_business_day_uses_shanghai_and_keeps_field_time(self):
        """周日晚上在山顶打卡、周一才补传：业务日仍归周日，窗口口径才不会被拖走。"""
        guest = V.new_guest(self.http, PREFIX + "g")
        start, peak, _ = self.pair()
        # 最近一个周日晚上 23:30（现场时间），周一/周二补传都要归到周日
        today = datetime.now(SHANGHAI)
        sunday = (today - timedelta(days=(today.weekday() + 1) % 7)).replace(
            hour=23, minute=30, second=0, microsecond=0)
        sunday = min(sunday, today - timedelta(hours=2))
        self.assertEqual(6, sunday.weekday())
        response = V.checkin_guest(self.http, guest, peak["code"], source="scan",
                                   clientUuid=V.action_uuid(),
                                   occurredAt=sunday.astimezone(timezone.utc).isoformat())
        data = V.ok(response, "周日现场时间打卡")
        row = V.sql_one("SELECT visit_date, occurred_at, recorded_at FROM visits WHERE id=%d"
                        % data["visitId"])
        self.assertEqual(sunday.date().isoformat(), row[0],
                         "业务日按上海时区算，归周日")
        self.assertTrue(row[2] > row[1], "recorded_at 是服务器时间，晚于现场时间")
        # 旧客户端不带新字段：走服务器当前时间，仍能打卡
        legacy = V.checkin_guest(self.http, guest, start["code"], source="scan")
        self.assertEqual(200, legacy.status_code)
        self.assertIn("seq", legacy.json())
        self.assertIn("visitedAt", legacy.json())

    # ---- 合并 ----

    def test_06_register_merge_keeps_canonical_visit_for_retry(self):
        """游客先打卡（离线重试场景）→ 注册合并 → 用同一 UUID 以账号身份重试：
        必须回到同一条 canonical 记录，不重复发号、不报错。"""
        guest = V.new_guest(self.http, PREFIX + "g")
        _, peak, _ = self.pair()
        action = V.action_uuid()
        at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        first = V.ok(V.checkin_guest(self.http, guest, peak["code"], source="scan",
                                     clientUuid=action, occurredAt=at), "游客打卡")
        account = V.new_account(self.http, PREFIX + "u")
        merged = V.ok(self.http.post("/api/me/merge-guest", json={},
                                     headers=dict(account["headers"],
                                                  **{"X-Guest-Token": guest["token"]})),
                      "注册后合并游客记录")
        self.assertEqual(1, merged["mergedVisits"])
        # 到访已经归到账号名下，仍然只有一条
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d AND user_id=%d"
                                      % (peak["id"], account["uid"])))
        retry = V.ok(V.checkin_account(self.http, account, peak["id"], source="scan",
                                       clientUuid=action, occurredAt=at), "账号身份重试")
        self.assertEqual(first["visitId"], retry["visitId"], "重试必须回到同一条记录")
        self.assertEqual(first["seq"], retry["seq"], "重试不得重新发号")
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                      % peak["id"]))

    def test_07_merge_with_existing_same_day_account_visit(self):
        """账号先在同一天同一点有记录，游客随后也打了一次，再合并：
        只留一条、成绩不悬空、老 UUID 重试仍回到保留下来的那条。"""
        account = V.new_account(self.http, PREFIX + "u")
        guest = V.new_guest(self.http, PREFIX + "g")
        _, peak, _ = self.pair()
        at_user = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
        at_guest = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
        kept = V.ok(V.checkin_account(self.http, account, peak["id"], source="scan",
                                      clientUuid=V.action_uuid(), occurredAt=at_user),
                    "账号先打卡")
        guest_action = V.action_uuid()
        gone = V.ok(V.checkin_guest(self.http, guest, peak["code"], source="scan",
                                    clientUuid=guest_action, occurredAt=at_guest),
                    "游客同日再打卡")
        merged = V.ok(self.http.post("/api/me/merge-guest", json={},
                                     headers=dict(account["headers"],
                                                  **{"X-Guest-Token": guest["token"]})),
                      "合并")
        self.assertEqual(1, merged["dropped"], "同一账号同日同点应归并掉游客那条")
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                      % peak["id"]))
        self.assertEqual(str(kept["visitId"]), V.sql_value(
            "SELECT id FROM visits WHERE point_id=%d" % peak["id"]))
        # 游客那条的 UUID 映射被重定向到保留下来的账号记录，重试不会悬空
        mapped = V.sql_value("""SELECT canonical_visit_id FROM visit_submission_receipts
            WHERE identity_type='user' AND identity_id=%d AND client_uuid='%s'"""
            % (account["uid"], guest_action))
        self.assertEqual(str(kept["visitId"]), str(mapped))
        retry = V.ok(V.checkin_account(self.http, account, peak["id"], source="scan",
                                       clientUuid=guest_action, occurredAt=at_guest),
                     "用游客动作 UUID 以账号身份重试")
        self.assertEqual(kept["visitId"], retry["visitId"])
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                      % peak["id"]))

    def test_08_merged_guest_token_cannot_read_or_write(self):
        """已合并的游客身份单独用：既不能打卡，也不能读账号数据。"""
        guest = V.new_guest(self.http, PREFIX + "g")
        account = V.new_account(self.http, PREFIX + "u")
        _, peak, _ = self.pair()
        V.ok(self.http.post("/api/me/merge-guest", json={},
                            headers=dict(account["headers"],
                                         **{"X-Guest-Token": guest["token"]})), "合并")
        blocked = V.checkin_guest(self.http, guest, peak["code"], source="scan",
                                  clientUuid=V.action_uuid(),
                                  occurredAt=datetime.now(timezone.utc).isoformat())
        self.assertEqual(401, blocked.status_code)
        receipts = self.http.get("/api/guest/visit-receipts", headers=guest["headers"])
        self.assertEqual(401, receipts.status_code)
        summary = self.http.get("/api/guest/mountain-summary", headers=guest["headers"])
        self.assertEqual(401, summary.status_code)

    def test_09_merge_does_not_steal_another_accounts_records(self):
        """游客已归入账号 A，账号 B 再拿同一个 token 合并：必须拒绝，不跨账号接管。"""
        guest = V.new_guest(self.http, PREFIX + "g")
        first = V.new_account(self.http, PREFIX + "u")
        second = V.new_account(self.http, PREFIX + "u")
        V.ok(self.http.post("/api/me/merge-guest", json={},
                            headers=dict(first["headers"],
                                         **{"X-Guest-Token": guest["token"]})), "第一次合并")
        again = self.http.post("/api/me/merge-guest", json={},
                               headers=dict(second["headers"],
                                            **{"X-Guest-Token": guest["token"]}))
        self.assertEqual(409, again.status_code)
        self.assertEqual("GUEST_ALREADY_MERGED", V.error_code(again))

    # ---- 注销 ----

    def test_10_account_deletion_clears_new_private_rows(self):
        account = V.new_account(self.http, PREFIX + "u")
        start, peak, _ = self.pair(with_course=True)
        at_start = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        at_peak = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        V.ok(V.checkin_account(self.http, account, start["id"], source="scan",
                               clientUuid=V.action_uuid(), occurredAt=at_start), "起点打卡")
        V.ok(V.checkin_account(self.http, account, peak["id"], source="scan",
                               clientUuid=V.action_uuid(), occurredAt=at_peak), "峰顶打卡")
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM segment_efforts WHERE user_id=%d"
                                      % account["uid"]), "两端都在时应配出成绩")
        V.ok(self.http.post("/api/me/letters", json={"text": "注销演练", "mode": "open"},
                            headers=account["headers"]), "写信")
        deleted = V.ok(self.http.post("/api/me/delete-account",
                                      json={"password": V.PASSWORD, "confirm": "注销"},
                                      headers=account["headers"]), "注销")
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM visits WHERE user_id=%d"
                                      % account["uid"]))
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM segment_efforts WHERE user_id=%d"
                                      % account["uid"]))
        self.assertEqual(0, V.sql_int("""SELECT count(*) FROM visit_submission_receipts
            WHERE identity_type='user' AND identity_id=%d""" % account["uid"]))
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM letters WHERE user_id=%d"
                                      % account["uid"]))
        self.assertIn("visitReceipts", deleted["removed"])
        self.assertIn("efforts", deleted["removed"])
        # 令牌立刻失效
        stale = self.http.get("/api/me/visit-receipts", headers=account["headers"])
        self.assertEqual(401, stale.status_code)


if __name__ == "__main__":
    unittest.main()
