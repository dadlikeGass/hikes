"""T1：契约、数据库与路线配置的验收（计划 T1）。

跑法（仓库根目录，先起隔离环境，见 server/tests/README.md）：

    V3_TEST_BASE_URL=http://127.0.0.1:18000 \
      python3 -m unittest discover -s server/tests -p 'v3_*_drill.py' -v

覆盖：空库升级到 head、旧库副本升级后旧行不被改写、到访证据列回填、
扫码查点仍可用、身份幂等键与「同一天同一人同一点一条」约束、
未来信模式约束、成绩唯一键与路线约束。
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
import json
import uuid as uuidlib

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

LEGACY_DUMP = os.environ.get(
    "V3_LEGACY_DUMP",
    os.path.join(V.REPO_ROOT, ".local-backups", "hikes-before-v3-2026-10-16.dump"))
LEGACY_DB = "v3legacy"


def _head_revision():
    """从 migrations/versions 推断当前 head，避免每加一个修订就要来改常量。"""
    folder = os.path.join(V.REPO_ROOT, "server", "migrations", "versions")
    names = sorted(name[:-3] for name in os.listdir(folder) if name.endswith(".py"))
    return names[-1]


HEAD = _head_revision()
PREFIX = "v3t1"


class SchemaDrill(unittest.TestCase):
    """新库上的结构与约束验收。"""

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)

    @classmethod
    def tearDownClass(cls):
        V.purge(PREFIX)
        cls.http.close()

    def test_01_head_and_new_objects_exist(self):
        self.assertEqual(HEAD, V.sql_value("SELECT version_num FROM alembic_version"),
                         "空库升级后应停在 0012")
        columns = {row[0] for row in V.sql_rows("""
            SELECT column_name FROM information_schema.columns
             WHERE table_name='visits'""")}
        self.assertTrue({"occurred_at", "recorded_at", "evidence_level",
                         "accuracy_m", "location_geom"} <= columns,
                        "visits 缺 V3 新列：%s" % (columns,))
        tables = {row[0] for row in V.sql_rows(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")}
        self.assertTrue({"visit_submission_receipts", "ascent_courses",
                         "segment_efforts"} <= tables)
        self.assertEqual(1, V.sql_int("""SELECT count(*) FROM information_schema.columns
            WHERE table_name='users' AND column_name='leaderboard_enabled'"""))
        self.assertEqual(1, V.sql_int("""SELECT count(*) FROM information_schema.columns
            WHERE table_name='letters' AND column_name='unlock_at'
              AND data_type='timestamp with time zone'"""),
                         "letters.unlock_at 必须是可空 timestamptz")

    def test_02_evidence_columns_have_no_null_rows(self):
        self.assertEqual(0, V.sql_int(
            "SELECT count(*) FROM visits WHERE occurred_at IS NULL OR recorded_at IS NULL"),
            "事件时间与记录时间都不允许为空")

    def test_03_legacy_rows_are_not_rank_evidence(self):
        self.assertEqual(0, V.sql_int("""SELECT count(*) FROM visits
            WHERE evidence_level NOT IN ('legacy','code','gps_close','manual')"""))
        self.assertEqual(0, V.sql_int(
            "SELECT count(*) FROM visits WHERE evidence_level='legacy' AND occurred_at <> created_at"),
            "legacy 行的 occurred_at 必须是 created_at 的回填值")

    def test_04_same_identity_point_day_is_single_row(self):
        """同一天同一身份同一点只允许一条；游客与账号各验一遍。"""
        now = datetime.now(timezone.utc)
        first_at = (now - timedelta(hours=3)).isoformat()
        second_at = (now - timedelta(hours=1)).isoformat()
        guest = V.new_guest(self.http, PREFIX + "g")
        point = V.new_point(PREFIX, lat=31.0, lng=121.0)
        first = V.checkin_guest(self.http, guest, point["code"], source="scan",
                                clientUuid=V.action_uuid(), occurredAt=first_at)
        V.ok(first, "游客打卡")
        second = V.checkin_guest(self.http, guest, point["code"], source="scan",
                                 clientUuid=V.action_uuid(), occurredAt=second_at)
        V.ok(second, "游客同日第二次打卡")
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                      % point["id"]))
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d AND seq=%d"
                                      % (point["id"], first.json()["seq"])))
        day = V.value_in("hikes", "SELECT visit_date FROM visits WHERE point_id=%d" % point["id"])
        self.assertTrue(V.sql_rejected("""INSERT INTO visits
            (guest_id, point_id, seq, visit_date, source, occurred_at, recorded_at)
            VALUES (%d, %d, 99, DATE '%s', 'scan', now(), now());"""
            % (guest["id"], point["id"], day)), "游客同日唯一索引没拦住重复行")

        account = V.new_account(self.http, PREFIX + "u")
        V.ok(V.checkin_account(self.http, account, point["id"], source="scan",
                               clientUuid=V.action_uuid(), occurredAt=first_at), "账号打卡")
        self.assertTrue(V.sql_rejected("""INSERT INTO visits
            (user_id, point_id, seq, visit_date, source, occurred_at, recorded_at)
            VALUES (%d, %d, 98, DATE '%s', 'scan', now(), now());"""
            % (account["uid"], point["id"], day)), "账号同日唯一约束没拦住重复行")

    def test_05_receipt_key_separates_guest_and_account(self):
        """幂等键是 (身份类型, 身份ID, clientUuid)：同数字 ID 的游客和账号互不干扰。"""
        guest = V.new_guest(self.http, PREFIX + "g")
        account = V.new_account(self.http, PREFIX + "u")
        action = V.action_uuid()
        V.sql("INSERT INTO visit_submission_receipts "
              "(identity_type, identity_id, client_uuid, payload_hash) VALUES "
              "('guest', %d, '%s', 'h1'), ('user', %d, '%s', 'h2');"
              % (guest["id"], action, account["uid"], action))
        self.assertEqual(2, V.sql_int(
            "SELECT count(*) FROM visit_submission_receipts WHERE client_uuid='%s'" % action))
        self.assertTrue(V.sql_rejected(
            "INSERT INTO visit_submission_receipts "
            "(identity_type, identity_id, client_uuid, payload_hash) VALUES "
            "('guest', %d, '%s', 'h3');" % (guest["id"], action)),
            "同一身份重复的 client_uuid 必须被唯一键挡住")

    def test_06_letter_mode_constraints(self):
        account = V.new_account(self.http, PREFIX + "u")
        point = V.new_point(PREFIX, lat=31.1, lng=121.1)
        uid, pid = account["uid"], point["id"]
        self.assertTrue(V.sql_rejected(
            "INSERT INTO letters (user_id, text, unlock_mode) VALUES (%d,'x','date');" % uid),
            "date 模式必须有 unlock_at")
        self.assertTrue(V.sql_rejected(
            "INSERT INTO letters (user_id, text, unlock_mode, unlock_at) "
            "VALUES (%d,'x','checkin', now());" % uid),
            "checkin 模式不允许带 unlock_at")
        self.assertFalse(V.sql_rejected(
            "INSERT INTO letters (user_id, text, unlock_mode, point_id) "
            "VALUES (%d,'x','checkin', %d);" % (uid, pid)),
            "checkin 带目标点位应当被接受")
        self.assertFalse(V.sql_rejected(
            "INSERT INTO letters (user_id, text, unlock_mode, unlock_at) "
            "VALUES (%d,'x','open', NULL);" % uid),
            "open 模式不要求任何解锁条件")
        self.assertTrue(V.sql_rejected(
            "INSERT INTO letters (user_id, text, unlock_mode, unlock_at) "
            "VALUES (%d,'x','open', now());" % uid),
            "open 模式不能带解封时间")
        self.assertTrue(V.sql_rejected(
            "INSERT INTO letters (user_id, text, unlock_mode, unlock_at) "
            "VALUES (%d,'x','datte', now());" % uid),
            "未知解锁模式必须被拒绝")

    def test_07_course_and_effort_constraints(self):
        mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))
        start = V.new_point(PREFIX, kind="trailhead", lat=31.2, lng=121.2, mountain_id=mountain)
        peak = V.new_point(PREFIX, kind="peak", lat=31.21, lng=121.21, mountain_id=mountain)
        self.assertTrue(V.sql_rejected(
            "INSERT INTO ascent_courses (mountain_id,start_point_id,end_point_id,name) "
            "VALUES (%d,%d,%d,'start-equals-end');" % (mountain, start["id"], start["id"])),
            "起点终点相同不能成为登顶路线")
        self.assertTrue(V.sql_rejected(
            "INSERT INTO ascent_courses "
            "(mountain_id,start_point_id,end_point_id,name,min_duration_s) "
            "VALUES (%d,%d,%d,'zero-floor',0);" % (mountain, start["id"], peak["id"])),
            "路线用时下限必须为正")
        course = V.new_course(PREFIX, mountain, start["id"], peak["id"], ranking_enabled=False)
        self.assertEqual("f", V.sql_value(
            "SELECT ranking_enabled FROM ascent_courses WHERE id=%d" % course["id"]),
            "试点路线默认不开榜")

    def test_08_scan_lookup_still_works(self):
        point = V.new_point(PREFIX, kind="peak", lat=31.3, lng=121.3, name="T1 scan point")
        V.new_short_link(point["code"], point["id"])
        detail = V.ok(self.http.get("/api/points/" + point["code"]), "扫码查点")
        self.assertEqual(point["code"], detail["code"])
        target = V.ok(self.http.get("/api/qr/%s/target" % point["code"]), "二维码内容")
        self.assertIn(point["code"], str(target))
        short = self.http.get("/p/" + point["code"], follow_redirects=False)
        self.assertEqual(302, short.status_code, "旧短链仍要 302 跳到到达页")
        self.assertIn("/app/#/arrive/p-" + point["code"], short.headers.get("location", ""))


class PilotConfigDrill(unittest.TestCase):
    """试点路线配置脚本：缺坐标只报告不开榜，核实后才允许开榜，且可重复执行。"""

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.tmp_files = []
        cls.mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))
        cls.peak = V.new_point(PREFIX, kind="peak", lat=39.99107, lng=116.1723,
                               mountain_id=cls.mountain)
        cls.other = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))

    @classmethod
    def tearDownClass(cls):
        for path in cls.tmp_files:
            if os.path.exists(path):
                os.remove(path)
        V.purge(PREFIX)
        cls.http.close()

    @classmethod
    def _config_file(cls, courses):
        name = "v3drill-%s.json" % uuidlib.uuid4().hex[:8]
        path = os.path.join(V.REPO_ROOT, "server", "seeds", name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"courses": courses}, handle, ensure_ascii=False)
        cls.tmp_files.append(path)
        return name

    @classmethod
    def _run(cls, name, *flags):
        return V.run_in_api("python", "/srv/seeds/v3_pilot_courses.py",
                            "--config", "/srv/seeds/" + name, *flags)

    def _course_name(self, tag):
        return "%s %s" % (PREFIX, tag)

    def _courses_on_this_mountain(self):
        return V.sql_int("SELECT count(*) FROM ascent_courses WHERE mountain_id=%d"
                         % self.mountain)

    def test_01_pending_start_is_reported_and_not_written(self):
        name = self._config_file([{
            "name": self._course_name("pending"),
            "mountain": V.sql_value("SELECT stable_key FROM mountains WHERE id=%d"
                                    % self.mountain),
            "start_point": {"code": V.unique(PREFIX + "s").upper(), "type": "trailhead",
                            "lat": None, "lng": None},
            "end_point": {"code": self.peak["code"]},
            "min_duration_s": 1800, "ranking_enabled": True}])
        output = self._run(name, "--apply")
        self.assertIn("待现场采集", output, "缺坐标的起点必须明确报告")
        self.assertIn("跳过", output)
        self.assertEqual(0, self._courses_on_this_mountain(), "半截路线不能落库")

    def test_02_ranking_needs_verified_coordinates(self):
        stable_key = V.sql_value("SELECT stable_key FROM mountains WHERE id=%d" % self.mountain)
        start_code = V.unique(PREFIX + "s").upper()
        name = self._config_file([{
            "name": self._course_name("verified"),
            "mountain": stable_key,
            "start_point": {"code": start_code, "type": "trailhead",
                            "name": "drill start", "lat": 39.999, "lng": 116.18},
            "end_point": {"code": self.peak["code"]},
            "distance_m": 2100, "gain_m": 380,
            "min_duration_s": 1800, "ranking_enabled": True}])

        output = self._run(name, "--apply")
        self.assertIn("没有 --coordinates-verified", output)
        self.assertEqual(1, V.sql_int("""SELECT count(*) FROM ascent_courses
            WHERE name='%s' AND ranking_enabled = FALSE""" % self._course_name("verified")),
            "没核实坐标的路线必须先落成参考成绩")
        self.assertEqual("draft", V.sql_value(
            "SELECT status FROM points WHERE code='%s'" % start_code),
            "没核实坐标时新建的起点只能是草稿")
        course_id = V.sql_value("SELECT id FROM ascent_courses WHERE name='%s'"
                                % self._course_name("verified"))

        output = self._run(name, "--apply", "--coordinates-verified")
        self.assertIn("已写入（开榜：True）", output)
        self.assertEqual(course_id, V.sql_value("SELECT id FROM ascent_courses WHERE name='%s'"
                                                % self._course_name("verified")),
                         "重复执行必须更新同一行，不能再插一条")
        self.assertEqual(1, V.sql_int("SELECT count(*) FROM ascent_courses WHERE name='%s'"
                                      % self._course_name("verified")))
        self.assertEqual("t", V.sql_value("SELECT ranking_enabled FROM ascent_courses WHERE id=%s"
                                          % course_id))
        self.assertEqual("published", V.sql_value("SELECT status FROM points WHERE code='%s'"
                                                  % start_code))

    def test_03_endpoint_from_another_mountain_is_rejected(self):
        stray = V.new_point(PREFIX, kind="peak", lat=39.5, lng=116.5, mountain_id=self.other)
        name = self._config_file([{
            "name": self._course_name("stray"),
            "mountain": V.sql_value("SELECT stable_key FROM mountains WHERE id=%d" % self.mountain),
            "start_point": {"code": self.peak["code"]},
            "end_point": {"code": stray["code"]},
            "min_duration_s": 600, "ranking_enabled": False}])
        output = self._run(name, "--apply")
        self.assertIn("不属于这座山", output)
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM ascent_courses WHERE name='%s'"
                                      % self._course_name("stray")))


class LegacyUpgradeDrill(unittest.TestCase):
    """把发布前的备份副本升到 head：旧数据一行不能变，新增列必须回填。"""

    @classmethod
    def setUpClass(cls):
        if not os.path.exists(LEGACY_DUMP):
            raise unittest.SkipTest(
                "没有旧库备份可验：" + LEGACY_DUMP +
                "（可用 V3_LEGACY_DUMP 指定；见 server/tests/README.md）")

    SNAPSHOT = """
        SELECT md5(string_agg(t, '' ORDER BY t)) FROM (
          SELECT 'points:' || count(*) || ':' || md5(string_agg(code, ',' ORDER BY code)) AS t
            FROM points
          UNION ALL SELECT 'visits:' || count(*) || ':' ||
            coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '-') FROM visits
          UNION ALL SELECT 'users:' || count(*) FROM users
          UNION ALL SELECT 'guests:' || count(*) FROM guests
          UNION ALL SELECT 'comments:' || count(*) FROM comments
        ) s"""

    def test_legacy_copy_upgrade_preserves_rows(self):
        V.recreate_database(LEGACY_DB)
        V.restore_dump(LEGACY_DB, LEGACY_DUMP)
        before_version = V.value_in(LEGACY_DB, "SELECT version_num FROM alembic_version")
        self.assertTrue(before_version and before_version < HEAD,
                        "备份副本应当停在 V3 之前的修订，实际 %s" % before_version)
        snapshot = V.value_in(LEGACY_DB, self.SNAPSHOT)
        points_before = V.int_in(LEGACY_DB, "SELECT count(*) FROM points")
        visits_before = V.int_in(LEGACY_DB, "SELECT count(*) FROM visits")
        self.assertGreater(visits_before, 0, "旧库副本应当自带到访样本")

        V.alembic_upgrade(LEGACY_DB)

        self.assertEqual(HEAD, V.value_in(LEGACY_DB, "SELECT version_num FROM alembic_version"),
                         "副本升级后应停在 head")
        self.assertEqual(points_before, V.int_in(LEGACY_DB, "SELECT count(*) FROM points"),
                         "升级不能增删点位")
        self.assertEqual(visits_before, V.int_in(LEGACY_DB, "SELECT count(*) FROM visits"),
                         "升级不能增删到访")
        self.assertEqual(snapshot, V.value_in(LEGACY_DB, self.SNAPSHOT), "旧行内容被改动了")
        self.assertEqual(visits_before, V.int_in(LEGACY_DB, """SELECT count(*) FROM visits
            WHERE occurred_at = created_at AND recorded_at = created_at"""),
            "旧到访的时间必须回填成 created_at")
        self.assertEqual(visits_before, V.int_in(LEGACY_DB,
            "SELECT count(*) FROM visits WHERE evidence_level='legacy'"),
            "旧到访一律标 legacy，不自动获得排名资格")
        self.assertEqual(0, V.int_in(LEGACY_DB, """SELECT count(*) FROM letters l
            WHERE NOT ((l.unlock_mode='date' AND l.unlock_at IS NOT NULL)
                    OR (l.unlock_mode='checkin' AND l.point_id IS NOT NULL
                        AND l.unlock_at IS NULL)
                    OR (l.unlock_mode='open' AND l.unlock_at IS NULL))"""),
            "升级后每条旧信都必须满足新的模式约束")
        self.assertEqual(0, V.int_in(LEGACY_DB,
            "SELECT count(*) FROM visit_submission_receipts"))
        self.assertEqual(0, V.int_in(LEGACY_DB, "SELECT count(*) FROM segment_efforts"),
                         "旧到访不得自动生成成绩")


if __name__ == "__main__":
    unittest.main()
