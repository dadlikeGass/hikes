"""T3：GPS 接入与统一到达页的服务端部分（计划 T3）。

覆盖：nearby 必须 POST 且不记到访、只返回已启用且有点位坐标的点、半径内外的边界、
低精度与缺坐标一律拒绝且不产生到访、拒绝信息与公开响应里都不出现精确坐标、
GPS 到访要留下可核验的位置证据（且这份证据不进公开接口）。
浏览器侧的定位权限/超时在 server/tests/v3_browser_checklist.md 里走真机核对。
"""
from __future__ import annotations

import math
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3t3"
LAT = 39.99
LNG = 116.10


def north(meters: float) -> float:
    """在 LAT 处向北偏移指定米数，用于卡半径边界。"""
    return meters / 111320.0


class GpsDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))

    def point(self, kind="peak", *, lat=LAT, lng=LNG, status="published", mountain=None):
        """每个用例自己造点位：共用点位会让"只落一条 / 计数为 0"的断言互相干扰。"""
        return V.new_point(PREFIX, kind=kind, lat=lat, lng=lng, status=status,
                           mountain_id=mountain or self.mountain)

    @classmethod
    def tearDownClass(cls):
        V.purge(PREFIX)
        cls.http.close()

    def gps_checkin(self, guest, point, *, meters=10.0, accuracy=10):
        """以点位自己的坐标为原点向北偏移 meters 米打卡。"""
        return V.checkin_guest(
            self.http, guest, point["code"], source="nearby",
            clientUuid=V.action_uuid(),
            occurredAt=(datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
            lat=point["lat"] + north(meters), lng=point["lng"], accuracyM=accuracy)

    # ---- nearby ----

    def test_01_nearby_lists_only_usable_points_by_distance(self):
        anchor = self.point()
        near = self.point(lat=LAT + north(60))
        outside_peak = self.point(lat=LAT + north(120))
        far = self.point(lat=LAT + north(5000))
        # 120 m：超过山顶 100 m 半径，但在山脚 / 岔路 150 m 半径内
        near150 = self.point(kind="trailhead", lat=LAT + north(120), lng=LNG + 0.0005)
        no_geom = self.point(lat=None, lng=None)      # 有编号但没有坐标的点位
        draft = self.point(status="draft")
        body = {"lat": LAT, "lng": LNG, "accuracyM": 8}
        rows = V.ok(self.http.post("/api/points/nearby", json=body), "附近点位")
        codes = [row["code"] for row in rows]
        self.assertIn(anchor["code"], codes)
        self.assertIn(near["code"], codes)
        self.assertNotIn(outside_peak["code"], codes, "山顶 100 米外不该出现")
        self.assertNotIn(far["code"], codes, "5 公里外的点位不该出现")
        self.assertNotIn(no_geom["code"], codes, "没有坐标的点位不能出现在附近列表")
        self.assertNotIn(draft["code"], codes, "未发布的点位不能出现在附近列表")
        distances = [row["distanceM"] for row in rows]
        self.assertEqual(distances, sorted(distances), "按距离排序")
        self.assertLessEqual(len(rows), 20)
        for row in rows:
            self.assertEqual({"pointId", "code", "name", "kind", "routeId", "routeName",
                              "mountainId", "mountainName", "distanceM",
                              "checkinRadiusM", "canCheckIn"},
                             set(row), "公开响应只给展示所需字段，不带精确坐标")
            self.assertIn(row["kind"], ("peak", "junction", "trailhead"))
        radii = {row["code"]: row["checkinRadiusM"] for row in rows}
        self.assertEqual(100, radii[anchor["code"]])
        self.assertEqual(150, radii[near150["code"]])
        # 查附近不产生到访
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM visits"))
        # 坐标不能进 URL（POST + body）
        bad = self.http.get("/api/points/nearby", params=body)
        self.assertIn(bad.status_code, (404, 405), "nearby 只允许 POST，坐标不进 URL")

    def test_02_nearby_rejects_out_of_range_coordinates(self):
        bad = self.http.post("/api/points/nearby",
                             json={"lat": 999, "lng": LNG, "accuracyM": 5})
        self.assertEqual(422, bad.status_code)

    # ---- 半径边界 ----

    def test_03_peak_radius_boundary(self):
        guest = V.new_guest(self.http, PREFIX + "g")
        peak = self.point()
        inside = self.gps_checkin(guest, peak, meters=85.0)
        data = V.ok(inside, "峰顶半径内 85 米打卡")
        row = V.sql_one("""SELECT evidence_level, accuracy_m, location_geom IS NOT NULL
            FROM visits WHERE id=%d""" % data["visitId"])
        self.assertEqual("gps_close", row[0], "GPS 到访要标成定位证据")
        self.assertEqual("10", row[1])
        self.assertEqual("t", row[2], "GPS 到访要留下可核验的位置证据")

        guest2 = V.new_guest(self.http, PREFIX + "g")
        outside = self.gps_checkin(guest2, peak, meters=140.0)
        self.assertEqual(422, outside.status_code)
        self.assertEqual("OUTSIDE_CHECKIN_RADIUS", V.error_code(outside))
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                      % peak["id"]), "半径外不能留下到访")

    def test_04_non_peak_radius_is_wider(self):
        head = self.point(kind="trailhead", lng=LNG + 0.02)
        guest = V.new_guest(self.http, PREFIX + "g")
        data = V.ok(self.gps_checkin(guest, head, meters=140.0), "登山口半径 140 米")
        self.assertEqual("gps_close", V.sql_value(
            "SELECT evidence_level FROM visits WHERE id=%d" % data["visitId"]))
        guest2 = V.new_guest(self.http, PREFIX + "g")
        too_far = self.gps_checkin(guest2, head, meters=180.0)
        self.assertEqual(422, too_far.status_code)
        self.assertEqual("OUTSIDE_CHECKIN_RADIUS", V.error_code(too_far))

    # ---- 精度与缺证据 ----

    def test_05_accuracy_and_missing_evidence_are_rejected(self):
        head = self.point(kind="trailhead", lng=LNG + 0.02)
        no_geom = self.point(lat=None, lng=None)
        draft = self.point(status="draft")
        guest = V.new_guest(self.http, PREFIX + "g")
        blurred = self.gps_checkin(guest, head, meters=20.0, accuracy=51)
        self.assertEqual(422, blurred.status_code)
        self.assertEqual("LOCATION_INACCURATE", V.error_code(blurred))
        no_position = V.checkin_guest(self.http, guest, head["code"], source="nearby",
                                      clientUuid=V.action_uuid(),
                                      occurredAt=datetime.now(timezone.utc).isoformat())
        self.assertEqual(422, no_position.status_code)
        self.assertEqual("LOCATION_REQUIRED", V.error_code(no_position))
        missing = V.checkin_guest(self.http, V.new_guest(self.http, PREFIX + "g"),
                                  no_geom["code"], source="nearby",
                                  clientUuid=V.action_uuid(),
                                  occurredAt=datetime.now(timezone.utc).isoformat(),
                                  lat=LAT, lng=LNG, accuracyM=8)
        self.assertEqual(422, missing.status_code)
        self.assertEqual("POINT_LOCATION_MISSING", V.error_code(missing))
        disabled = self.gps_checkin(V.new_guest(self.http, PREFIX + "g"), draft)
        self.assertEqual(422, disabled.status_code)
        self.assertEqual("GPS_NOT_ENABLED", V.error_code(disabled))
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM visits WHERE point_id IN (%d,%d,%d)"
                                      % (head["id"], no_geom["id"], draft["id"])),
                         "被拒的定位打卡一律不得留下到访")

    def test_06_rejections_never_leak_coordinates(self):
        guest = V.new_guest(self.http, PREFIX + "g")
        peak = self.point()
        response = self.gps_checkin(guest, peak, meters=140.0)
        self.assertEqual(422, response.status_code)
        text = response.text
        for leak in ("39.99", "116.10", "39.9", "116.1", "lat", "lng"):
            self.assertNotIn(leak, text, "拒绝响应里不能回显坐标：%s" % text[:200])
        # 开发库/隔离库里也不能把拒绝写进到访或回执
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                      % peak["id"]))

    # ---- 公开接口不带精确坐标 ----

    def test_07_public_payloads_hide_raw_coordinates(self):
        account = V.new_account(self.http, PREFIX + "u")
        head = self.point(kind="trailhead", lng=LNG + 0.02)
        V.ok(V.checkin_account(self.http, account, head["id"], source="nearby",
                               clientUuid=V.action_uuid(),
                               occurredAt=datetime.now(timezone.utc).isoformat(),
                               lat=head["lat"] + north(30), lng=head["lng"], accuracyM=12),
             "账号 GPS 打卡")
        receipts = V.ok(self.http.get("/api/me/visit-receipts", headers=account["headers"]),
                        "我的凭证")
        self.assertTrue(receipts)
        self.assertEqual({"visitId", "code", "name", "kind", "seq", "visitedAt",
                          "recordedAt", "durationS", "effortReason"},
                         set(receipts[0]))
        summary = V.ok(self.http.get("/api/me/mountain-summary", headers=account["headers"]),
                       "山级摘要")
        self.assertEqual({"mountainId", "name", "visitorCount", "myLastVisitedAt"},
                         set(summary[0]))
        point = V.ok(self.http.get("/api/points/" + head["code"]), "点位详情")
        self.assertNotIn("location_geom", json_keys(point))
        self.assertEqual("12", V.sql_value(
            "SELECT accuracy_m FROM visits WHERE id=%d" % receipts[0]["visitId"]),
            "库里的精度仍要保留，供 30 天内核对")


def json_keys(payload):
    return set(payload.keys())


if __name__ == "__main__":
    unittest.main()
