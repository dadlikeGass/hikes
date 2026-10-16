"""占山为王申请（山大王 / 版主）的服务端验收。

覆盖：申请必填项（理由 ≥20 字、期待 ≥10 字、每月能去几次 1–30）、同一人同一座山
只能有一份待审、3 天审核期到期自动失效、山大王（单人）通过即独占且同山其它待审
自动驳回并写明理由、已被人独占时新申请只能走山寨、山寨（多人）可以多人通过并
都成为协作者、不能审核自己的申请、驳回必须写说明、撤回、审核记录可追溯。
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3t9"


class MasterApplicationDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.mountain, cls.peak = None, None      # 由 target() 按用例创建
        cls.reviewer = V.new_account(cls.http, PREFIX + "r")
        V.sql("""INSERT INTO system_roles (user_id, role)
            VALUES (%d, 'collaboration_reviewer') ON CONFLICT DO NOTHING"""
            % cls.reviewer["uid"])

    @classmethod
    def tearDownClass(cls):
        V.sql("""DELETE FROM master_applications WHERE applicant_id IN
            (SELECT id FROM users WHERE username LIKE '%s%%')""" % PREFIX)
        V.sql("""DELETE FROM board_collaboration_applications WHERE applicant_id IN
            (SELECT id FROM users WHERE username LIKE '%s%%')""" % PREFIX)
        V.purge(PREFIX)
        cls.http.close()

    def target(self, tag="feng"):
        """每个用例自己的山头 + 点位 + 留言板：共用点位会让上一条用例的
        "自动驳回同山其它待审"把这一条的申请一起清掉。"""
        mountain = V.new_mountain(PREFIX, V.unique(PREFIX + tag))
        peak = V.new_point(PREFIX, kind="peak", lat=30.0, lng=120.0,
                           mountain_id=mountain, name="申请演练峰")
        V.sql("""INSERT INTO boards (board_type, mountain_id)
            VALUES ('summit', %d) ON CONFLICT (mountain_id) DO NOTHING""" % mountain)
        return mountain, peak

    def apply(self, account, code=None, **fields):
        code = code or (self.peak or {}).get("code")
        body = {"code": code, "kind": "solo",
                "reason": "这座山我爬了三年，想在每个岔口把路况写清楚给后来的人看",
                "expectations": "把雨季的滑坡点和取水点标出来",
                "visitsPerMonth": 4}
        body.update(fields)
        return self.http.post("/api/master-applications", json=body,
                              headers=account["headers"])

    def review(self, application_id, decision, note="资料核过，可以"):
        return self.http.post("/api/admin/master-applications/%d/review" % application_id,
                              json={"decision": decision, "note": note},
                              headers=self.reviewer["headers"])

    # ---- 提交与校验 ----

    def test_01_required_fields(self):
        self.mountain, self.peak = self.target()
        account = V.new_account(self.http, PREFIX + "u")
        short_reason = self.apply(account, reason="想维护")
        self.assertEqual(422, short_reason.status_code)
        short_expect = self.apply(account, expectations="管一管")
        self.assertEqual(422, short_expect.status_code)
        bad_visits = self.apply(account, visitsPerMonth=0)
        self.assertEqual(422, bad_visits.status_code)
        too_many = self.apply(account, visitsPerMonth=31)
        self.assertEqual(422, too_many.status_code)
        missing = self.apply(account, code="NOT-A-CODE")
        self.assertEqual(404, missing.status_code)
        ok = V.ok(self.apply(account), "提交申请")
        self.assertEqual("pending", ok["status"])
        self.assertEqual(self.peak["code"], ok["pointCode"])
        self.assertIn("3 天", ok["message"])
        # 3 天审核期：due_at ≈ created_at + 3 天
        days = V.sql_value("""SELECT round(extract(epoch FROM (due_at - created_at)) / 86400)
            FROM master_applications WHERE id = %d""" % ok["id"])
        self.assertEqual("3", days)

    def test_02_one_pending_per_person_and_mountain(self):
        self.mountain, self.peak = self.target()
        account = V.new_account(self.http, PREFIX + "u")
        V.ok(self.apply(account), "第一份")
        again = self.apply(account)
        self.assertEqual(409, again.status_code)
        self.assertEqual("APPLICATION_PENDING", V.error_code(again))

    def test_03_expiry_after_three_days(self):
        self.mountain, self.peak = self.target()
        account = V.new_account(self.http, PREFIX + "u")
        first = V.ok(self.apply(account), "提交")
        V.sql("UPDATE master_applications SET due_at = now() - interval '1 minute' WHERE id = %d"
              % first["id"])
        mine = V.ok(self.http.get("/api/me/master-applications",
                                  headers=account["headers"]), "我的申请")
        self.assertEqual("expired", mine[0]["status"], "3 天没处理就要失效，不能一直挂着")
        self.assertIn("3 天", mine[0]["reviewNote"])
        late = self.review(first["id"], "approved")
        self.assertEqual(409, late.status_code)
        self.assertEqual("APPLICATION_CLOSED", V.error_code(late))
        # 失效后可以重新申请
        V.ok(self.apply(account), "重新申请")

    # ---- 单人山大王 ----

    def test_04_solo_approval_is_exclusive_and_closes_competitors(self):
        self.mountain, self.peak = self.target()
        winner = V.new_account(self.http, PREFIX + "u")
        loser = V.new_account(self.http, PREFIX + "u")
        first = V.ok(self.apply(winner), "甲的申请")
        second = V.ok(self.apply(loser), "乙的申请")
        approved = V.ok(self.review(first["id"], "approved"), "通过甲的申请")
        self.assertEqual(1, approved["autoRejected"], "同山其它待审要自动驳回")
        self.assertEqual("approved", V.sql_value(
            "SELECT status FROM master_applications WHERE id = %d" % first["id"]))
        self.assertEqual("rejected", V.sql_value(
            "SELECT status FROM master_applications WHERE id = %d" % second["id"]))
        self.assertIn("另一位申请人", V.sql_value(
            "SELECT review_note FROM master_applications WHERE id = %d" % second["id"]))
        self.assertEqual(str(winner["uid"]), V.sql_value(
            "SELECT maintainer_id FROM points WHERE id = %d" % self.peak["id"]))
        self.assertEqual(1, V.sql_int("""SELECT count(*) FROM claims
            WHERE user_id = %d AND target_key = 'master:%s'""" % (winner["uid"], self.peak["code"])))
        # 已经有人独占，同山再来一份 solo 申请会被挡住，并提示可以走山寨
        third = V.new_account(self.http, PREFIX + "u")
        blocked = self.apply(third)
        self.assertEqual(409, blocked.status_code)
        self.assertEqual("ALREADY_MASTERED", V.error_code(blocked))
        self.assertIn("山寨", V.error_message(blocked), "提示里要告诉用户可以申请协作")

    # ---- 山寨（多人协作）----

    def test_05_clan_allows_multiple_maintainers(self):
        mountain, peak = self.target("shanzhai")
        first = V.new_account(self.http, PREFIX + "u")
        second = V.new_account(self.http, PREFIX + "u")
        one = V.ok(self.apply(first, code=peak["code"], kind="clan"), "甲的协作申请")
        two = V.ok(self.apply(second, code=peak["code"], kind="clan"), "乙的协作申请")
        V.ok(self.review(one["id"], "approved"), "通过甲")
        V.ok(self.review(two["id"], "approved"), "通过乙")
        collaborators = V.sql_int("""SELECT count(*) FROM board_collaboration_applications ca
            JOIN boards b ON b.id = ca.board_id
            WHERE b.mountain_id = %d AND ca.status = 'approved'""" % mountain)
        self.assertEqual(2, collaborators, "山寨允许同一座山多人通过")
        self.assertIsNotNone(V.sql_value(
            "SELECT maintainer_id FROM points WHERE id = %d" % peak["id"]),
            "第一个人顺带成为维护人（物料要有人对接）")

    # ---- 审核纪律 ----

    def test_06_review_rules(self):
        self.mountain, self.peak = self.target()
        account = V.new_account(self.http, PREFIX + "u")
        row = V.ok(self.apply(account), "提交")
        self_review = self.http.post("/api/admin/master-applications/%d/review" % row["id"],
                                     json={"decision": "approved", "note": "自己批自己"},
                                     headers=account["headers"])
        self.assertIn(self_review.status_code, (401, 403))
        short_note = self.review(row["id"], "rejected", note="不行")
        self.assertEqual(422, short_note.status_code)
        rejected = V.ok(self.review(row["id"], "rejected", note="理由写得不具体，请补充常走的线路"),
                        "驳回")
        self.assertEqual("rejected", rejected["status"])
        mine = V.ok(self.http.get("/api/me/master-applications",
                                  headers=account["headers"]), "我的申请")
        self.assertIn("请补充常走的线路", mine[0]["reviewNote"], "驳回理由要能看到")
        again = self.review(row["id"], "approved")
        self.assertEqual(409, again.status_code, "同一份申请不能二次审核")
        self.assertGreaterEqual(V.sql_int("""SELECT count(*) FROM maintenance_audit_logs
            WHERE target_type = 'master_application' AND target_id = %d""" % row["id"]), 2,
            "提交与审核都要留审计")

    def test_07_withdraw(self):
        self.mountain, self.peak = self.target()
        account = V.new_account(self.http, PREFIX + "u")
        row = V.ok(self.apply(account), "提交")
        V.ok(self.http.post("/api/master-applications/%d/withdraw" % row["id"],
                            json={"note": "今年去不了"}, headers=account["headers"]), "撤回")
        mine = V.ok(self.http.get("/api/me/master-applications",
                                  headers=account["headers"]), "我的申请")
        self.assertEqual("withdrawn", mine[0]["status"])
        self.assertEqual(404, self.http.post(
            "/api/master-applications/%d/withdraw" % row["id"], json={},
            headers=account["headers"]).status_code)

    def test_08_queue_lists_applicant_and_reason(self):
        self.mountain, self.peak = self.target()
        account = V.new_account(self.http, PREFIX + "u")
        submitted = V.ok(self.apply(account, kind="clan", visitsPerMonth=6,
                                    reason="我们是一个五人小队，每周都在这片山里训练，想把岔路情报维护好",
                                    expectations="每周更新岔路情报和队伍训练点位"), "提交")
        queue = V.ok(self.http.get("/api/admin/master-applications?status=pending",
                                  headers=self.reviewer["headers"]), "审核队列")
        mine = [row for row in queue if row["id"] == submitted["id"]]
        self.assertTrue(mine, "刚提交的申请要在待审队列里")
        self.assertTrue(mine[0]["applicantName"], "队列要能看到申请人")
        self.assertEqual(6, mine[0]["visitsPerMonth"])
        self.assertTrue(mine[0]["reason"])
        self.assertEqual({"id", "kind", "status", "pointCode", "pointId", "mountainName",
                          "reason", "expectations", "visitsPerMonth", "dueAt", "createdAt",
                          "reviewNote", "decidedAt", "applicantName"}, set(mine[0]))


if __name__ == "__main__":
    unittest.main()
