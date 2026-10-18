"""山脚候选核验：轨迹起点只进草稿，负责人/地理审核员确认后才可打卡。"""
from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3th"
LAT = 30.55
LNG = 104.06


class TrailheadDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))
        cls.other_mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan2"))
        cls.owner = V.new_account(cls.http, PREFIX + "owner")
        cls.other = V.new_account(cls.http, PREFIX + "other")
        cls.curator = V.new_account(cls.http, PREFIX + "cur")
        V.sql("""INSERT INTO system_roles (user_id, role)
            VALUES (%d, 'place_curator') ON CONFLICT DO NOTHING""" % cls.curator["uid"])
        V.sql("""INSERT INTO mountain_members (mountain_id, user_id, role, status)
            VALUES (%d, %d, 'owner', 'active')""" % (cls.mountain, cls.owner["uid"]))

    @classmethod
    def tearDownClass(cls):
        V.purge(PREFIX)
        cls.http.close()

    def candidate(self, mountain=None, *, lat=LAT, lng=LNG):
        code = V.unique(PREFIX + "p").upper()
        guide = json.dumps({"candidate_source": "route_start",
                            "review_required": True,
                            "trailhead_review": "draft"}, ensure_ascii=False)
        V.psql("""INSERT INTO points (code, type, status, name, mountain_id, geom, guide)
            VALUES (%s, 'trailhead', 'draft', %s, %d,
                    ST_SetSRID(ST_MakePoint(%f,%f),4326), CAST(%s AS jsonb));""" % (
            V.lit(code), V.lit(code + " 候选"),
            mountain if mountain is not None else self.mountain,
            lng, lat, V.lit(guide)))
        return {"code": code,
                "id": int(V.sql_int("SELECT id FROM points WHERE code=" + V.lit(code)))}

    def queue(self, account):
        return V.ok(self.http.get("/api/me/trailhead-candidates",
                                  headers=account["headers"]), "候选队列")

    def review(self, account, point, **body):
        body.setdefault("decision", "publish")
        return self.http.post("/api/points/%d/trailhead-review" % point["id"],
                              json=body, headers=account["headers"])

    def test_01_queue_is_scoped_to_owner_or_curator(self):
        mine = self.candidate()
        foreign = self.candidate(mountain=self.other_mountain, lat=LAT + 0.01)
        owner_codes = [x["code"] for x in self.queue(self.owner)]
        other_codes = [x["code"] for x in self.queue(self.other)]
        curator_codes = [x["code"] for x in self.queue(self.curator)]
        self.assertIn(mine["code"], owner_codes)
        self.assertNotIn(foreign["code"], owner_codes, "不能看到别的山头的候选")
        self.assertNotIn(foreign["code"], other_codes, "无关用户看不到候选")
        self.assertIn(foreign["code"], curator_codes, "地理审核员能看全部")

    def test_02_publish_requires_name_and_becomes_checkinable(self):
        point = self.candidate()
        missing = self.review(self.owner, point, name="")
        self.assertEqual(422, missing.status_code)
        self.assertEqual("TRAILHEAD_NAME_REQUIRED", V.error_code(missing))
        done = self.review(self.owner, point, name="测试山脚",
                           lat=LAT + 0.0002, lng=LNG)
        data = V.ok(done, "发布山脚")
        self.assertEqual("published", data["status"])
        near = V.ok(self.http.post("/api/points/nearby", json={
            "lat": LAT + 0.0002, "lng": LNG, "accuracyM": 8}), "附近点位")
        self.assertIn(point["code"], [x["code"] for x in near],
                      "发布后的山脚必须进入附近打卡")
        # 已处理过的候选不再进队列，也不能二次发布
        self.assertNotIn(point["code"], [x["code"] for x in self.queue(self.owner)])
        again = self.review(self.owner, point, name="再发一次")
        self.assertEqual(409, again.status_code)

    def test_03_reject_stays_draft_and_never_appears_nearby(self):
        point = self.candidate(lat=LAT + 0.02)
        done = V.ok(self.review(self.owner, point, decision="reject",
                                note="不是山脚"), "标掉候选")
        self.assertEqual("rejected", done["review"])
        self.assertEqual("draft", V.psql("SELECT status FROM points WHERE id=%d"
                                         % point["id"]).strip())
        self.assertNotIn(point["code"], [x["code"] for x in self.queue(self.owner)])
        near = V.ok(self.http.post("/api/points/nearby", json={
            "lat": LAT + 0.02, "lng": LNG, "accuracyM": 8}), "附近点位")
        self.assertNotIn(point["code"], [x["code"] for x in near])

    def test_04_other_users_cannot_review(self):
        point = self.candidate(lat=LAT + 0.03)
        denied = self.review(self.other, point, name="别人的山脚")
        self.assertEqual(403, denied.status_code)
        self.assertEqual("TRAILHEAD_REVIEW_FORBIDDEN", V.error_code(denied))


if __name__ == "__main__":
    unittest.main()
