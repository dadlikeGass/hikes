"""T5：成绩配对、榜单与设置（计划 T5）。

覆盖：终点先到起点后到、跨天、超 12 小时、低于路线用时下限、离线补传、游客、
未核实路线、弱证据各自的处理；幂等重算；每窗口每人只算最快一次；
7/8 人门槛、并列名次、百分位不含同用时；关闭上榜即时退出分母；
榜单接口故障不影响打卡，补偿作业跑完成绩自己出现。

榜单阈值类用例需要十几个身份，用 SQL 直接造（并注明）——注册接口有
10 次/IP/小时的安全阈值，靠注册去堆会把真正的产品逻辑淹没在限流里。
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3t5"
SHANGHAI = ZoneInfo("Asia/Shanghai")


def same_business_day_base(start_minutes: int):
    """给"若干分钟前"找个不会跨上海业务日的基准时间。

    drill 在上海零点前后跑时，"60 分钟前打卡起点、20 分钟前打卡终点"会掉进两个业务日，
    被"跨业务日不配对"这条正确规则挡住，用例就假失败（2026-10-16 16:2x UTC 撞过一次）。
    零点后不足 start_minutes 时，把基准挪到昨天中午，两端仍然落在同一天。
    """
    now = datetime.now(timezone.utc)
    local = now.astimezone(SHANGHAI)
    if local.hour == 0 and local.minute < start_minutes + 5:
        noon = (local - timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)
        return noon.astimezone(timezone.utc)
    return now


class EffortDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))

    def pair_course(self, *, min_duration_s=300, verified=True):
        """每个用例一套自己的起终点 + 路线。

        共用点位会让别的用例（以及补偿作业重扫）把成绩算到同一条路线上，
        "样本数 / 只落一条"这类断言立刻失去意义。
        """
        start = V.new_point(PREFIX, kind="trailhead", lat=39.95, lng=116.10,
                            mountain_id=self.mountain)
        peak = V.new_point(PREFIX, kind="peak", lat=39.99, lng=116.17,
                           mountain_id=self.mountain)
        course = V.new_course(PREFIX, self.mountain, start["id"], peak["id"],
                              ranking_enabled=verified, min_duration_s=min_duration_s)
        return start, peak, course

    @classmethod
    def tearDownClass(cls):
        V.drop_effort_failure_trigger()
        V.purge(PREFIX)
        cls.http.close()

    # ---- 造场景的小工具 ----

    def checkin_at(self, account, point_id, occurred_at, *, source="scan"):
        """按指定现场时间打卡，并把 recorded_at 对到现场时间附近。

        计划 3.1 只让"实时提交"的端点进公开榜：离线补传（提交时间明显晚于现场时间）
        会被标 offline_submission。drill 里没法真等半小时，所以打卡仍然走真实接口，
        之后只把 recorded_at 校正成"当场提交"的样子（差 20 秒）。
        """
        data = V.ok(V.checkin_account(self.http, account, point_id, source=source,
                                     clientUuid=V.action_uuid(),
                                     occurredAt=occurred_at.isoformat()), "打卡")
        V.sql("UPDATE visits SET recorded_at = occurred_at + interval '20 seconds' WHERE id=%d"
              % data["visitId"])
        return data

    def checkin_guest_at(self, guest, code, occurred_at, *, source="scan"):
        data = V.ok(V.checkin_guest(self.http, guest, code, source=source,
                                    clientUuid=V.action_uuid(),
                                    occurredAt=occurred_at.isoformat()), "游客打卡")
        V.sql("UPDATE visits SET recorded_at = occurred_at + interval '20 seconds' WHERE id=%d"
              % data["visitId"])
        return data

    def recompute(self):
        """跑一次补偿作业做重算。

        drill 为了造出"合格成绩"，把 recorded_at 校正成了"当场提交"；
        校正发生在打卡请求之后，所以这里再用作业重算一次——顺带证明
        重算幂等、以及"补偿作业能让原凭证自己出现正确成绩"。
        """
        return V.run_in_api("python", "/srv/jobs/reconcile_efforts.py")

    def walk(self, account, start, peak, *, start_minutes, end_minutes,
             start_source="scan", end_source="scan"):
        """同一个账号先扫起点、再扫峰顶；两条到访都按"现场时间 + 当场提交"记账。"""
        now = same_business_day_base(start_minutes)
        first = self.checkin_at(account, start["id"],
                                now - timedelta(minutes=start_minutes), source=start_source)
        second = self.checkin_at(account, peak["id"],
                                 now - timedelta(minutes=end_minutes), source=end_source)
        return first, second

    def effort_row(self, uid, course):
        return V.sql_one("""SELECT id, duration_s, eligible, excluded_reason FROM segment_efforts
            WHERE user_id=%d AND course_id=%d ORDER BY id DESC LIMIT 1"""
            % (uid, course["id"]))

    def seed_users(self, count, start, peak, course, *, duration_s, eligible=True,
                   reason=None, day=None):
        """造"已经配对好的成绩"：账号走真实注册（要令牌做设置类用例），
        到访与成绩用 SQL 直接写——这里验的是榜单统计，不必为了造 8 个人去跑 16 次打卡。
        """
        day = day or (datetime.now(SHANGHAI).date() - timedelta(days=1))
        start_at = datetime(day.year, day.month, day.day, 8, 0, tzinfo=SHANGHAI)
        end_at = start_at + timedelta(seconds=duration_s)
        V.reset_rate_limits()          # 注册接口 10 次/IP/小时，批量造号前先清计数
        created = []
        for _ in range(count):
            account = V.new_account(self.http, PREFIX + "u")
            uid = account["uid"]
            # recorded_at 必须贴着现场时间：作业重算时"提交时间明显晚于现场时间"
            # 会被判成离线补传，成绩就不该进公开榜了（计划 3.1）。
            start_visit = int(V.sql_int("""INSERT INTO visits
                (user_id, point_id, seq, visit_date, source, occurred_at, recorded_at,
                 evidence_level) VALUES (%d, %d,
                 (SELECT coalesce(max(seq),0)+1 FROM visits WHERE point_id=%d),
                 DATE '%s', 'scan', TIMESTAMPTZ '%s',
                 TIMESTAMPTZ '%s' + interval '20 seconds', 'code') RETURNING id"""
                % (uid, start["id"], start["id"], day, start_at.isoformat(),
                   start_at.isoformat())))
            end_visit = int(V.sql_int("""INSERT INTO visits
                (user_id, point_id, seq, visit_date, source, occurred_at, recorded_at,
                 evidence_level) VALUES (%d, %d,
                 (SELECT coalesce(max(seq),0)+1 FROM visits WHERE point_id=%d),
                 DATE '%s', 'scan', TIMESTAMPTZ '%s',
                 TIMESTAMPTZ '%s' + interval '20 seconds', 'code') RETURNING id"""
                % (uid, peak["id"], peak["id"], day, end_at.isoformat(),
                   end_at.isoformat())))
            V.sql("""INSERT INTO segment_efforts (user_id, course_id, start_visit_id,
                end_visit_id, visit_date, start_at, end_at, duration_s, eligible,
                excluded_reason) VALUES (%d, %d, %d, %d, DATE '%s', TIMESTAMPTZ '%s',
                TIMESTAMPTZ '%s', %d, %s, %s);"""
                % (uid, course["id"], start_visit, end_visit, day,
                   start_at.isoformat(), end_at.isoformat(), duration_s,
                   "TRUE" if eligible else "FALSE",
                   V.lit(reason) if reason else "NULL"))
            created.append(account)
        return created

    def leaderboard(self, course, window="week", account=None):
        url = "/api/efforts/leaderboard?courseId=%d&window=%s" % (course["id"], window)
        headers = account["headers"] if account else None
        return V.ok(self.http.get(url, headers=headers), "用时榜")

    # ---- 配对 ----

    def test_01_end_before_start_still_pairs_once(self):
        """终点先上传、起点后上传：最终只有一条成绩，用时等于两端时间差。"""
        start, peak, course = self.pair_course(min_duration_s=1800)
        account = V.new_account(self.http, PREFIX + "u")
        now = same_business_day_base(62)
        self.checkin_at(account, peak["id"], now - timedelta(minutes=22))   # 先传终点
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM segment_efforts WHERE user_id=%d"
                                      % account["uid"]), "只有一端时不该有成绩")
        self.checkin_at(account, start["id"], now - timedelta(minutes=62))  # 再传起点
        row = self.effort_row(account["uid"], course)
        self.assertIsNotNone(row, "两端到齐后要自动配对出成绩，不必等作业")
        self.recompute()
        row = self.effort_row(account["uid"], course)
        self.assertEqual(2400, int(row[1]))
        self.assertEqual("t", row[2])
        self.assertEqual(1, V.sql_int("""SELECT count(*) FROM segment_efforts
            WHERE user_id=%d AND course_id=%d""" % (account["uid"], course["id"])))

    def test_02_reconcile_is_idempotent(self):
        start, peak, course = self.pair_course()
        account = V.new_account(self.http, PREFIX + "u")
        self.walk(account, start, peak, start_minutes=60, end_minutes=20)
        before = V.sql_int("SELECT count(*) FROM segment_efforts WHERE user_id=%d"
                           % account["uid"])
        output = self.recompute()
        self.assertIn('"failures": 0', output, "补偿作业要跑成功")
        self.assertIn('"ok": true', output, "作业结果要能直接 grep")
        self.assertEqual(before, V.sql_int("SELECT count(*) FROM segment_efforts WHERE user_id=%d"
                                           % account["uid"]),
                         "重复配对不能再插一条")
        self.assertGreaterEqual(V.sql_int("""SELECT count(*) FROM job_runs
            WHERE name='reconcile_efforts' AND status='ok'"""), 1, "作业要留台账")

    def test_03_cross_day_and_too_long_are_not_paired(self):
        """跨业务日与超过 12 小时都不算一次登顶。"""
        start_point, peak, course = self.pair_course()
        day = datetime.now(SHANGHAI).date() - timedelta(days=2)
        account = V.new_account(self.http, PREFIX + "u")
        start_at = datetime(day.year, day.month, day.day, 23, 0, tzinfo=SHANGHAI)
        self.checkin_at(account, start_point["id"], start_at)
        self.checkin_at(account, peak["id"], start_at + timedelta(minutes=90))
        self.assertIsNone(self.effort_row(account["uid"], course), "跨业务日不配对")
        long_account = V.new_account(self.http, PREFIX + "u")
        now = datetime.now(timezone.utc)
        self.checkin_at(long_account, start_point["id"], now - timedelta(hours=14))
        self.checkin_at(long_account, peak["id"], now - timedelta(hours=1))
        self.assertIsNone(self.effort_row(long_account["uid"], course), "超过 12 小时不配对")

    # ---- 资格 ----

    def test_04_eligibility_reasons(self):
        now = same_business_day_base(60)
        start, peak, course = self.pair_course(min_duration_s=1800)
        unverified = V.new_course(PREFIX, self.mountain, start["id"], peak["id"],
                                  ranking_enabled=False, min_duration_s=300,
                                  name=V.unique(PREFIX + "unverified"))
        too_fast = V.new_account(self.http, PREFIX + "u")
        self.walk(too_fast, start, peak, start_minutes=25, end_minutes=5)
        self.recompute()
        row = self.effort_row(too_fast["uid"], course)
        self.assertEqual("f", row[2])
        self.assertEqual("too_fast", row[3], "比自己配的用时下限还快，只能当参考")

        guest = V.new_guest(self.http, PREFIX + "g")
        self.checkin_guest_at(guest, start["code"], now - timedelta(hours=1))
        self.checkin_guest_at(guest, peak["code"], now - timedelta(minutes=20))
        self.recompute()
        guest_effort = V.sql_one("""SELECT eligible, excluded_reason FROM segment_efforts
            WHERE guest_id=%d AND course_id=%d ORDER BY id DESC LIMIT 1"""
            % (guest["id"], course["id"]))
        self.assertEqual(["f", "guest"], guest_effort, "游客成绩只做个人参考")

        manual = V.new_account(self.http, PREFIX + "u")
        self.walk(manual, start, peak, start_minutes=60, end_minutes=20, start_source="manual")
        self.recompute()
        row = self.effort_row(manual["uid"], course)
        self.assertEqual("weak_evidence", row[3], "手动补记的端点不能进公开榜")

        unverified_account = V.new_account(self.http, PREFIX + "u")
        self.walk(unverified_account, start, peak, start_minutes=60, end_minutes=20)
        self.recompute()
        row = self.effort_row(unverified_account["uid"], unverified)
        self.assertEqual("course_unverified", row[3], "没法区分路径的路线只留参考用时")

    def test_05_offline_submission_does_not_rank(self):
        """离线补传可以留纪念，但不直接取得公开排名资格，并说明原因。"""
        start, peak, course = self.pair_course()
        account = V.new_account(self.http, PREFIX + "u")
        now = datetime.now(timezone.utc)
        self.checkin_at(account, start["id"], now - timedelta(hours=4))
        # 把起点伪装成"当天在现场、隔了两小时才补传"：recorded_at 远晚于 occurred_at
        V.sql("UPDATE visits SET recorded_at = occurred_at + interval '2 hours' "
              "WHERE user_id=%d AND point_id=%d" % (account["uid"], start["id"]))
        self.checkin_at(account, peak["id"], now - timedelta(hours=3))
        self.recompute()
        row = self.effort_row(account["uid"], course)
        self.assertEqual("f", row[2])
        self.assertEqual("offline_submission", row[3])
        board = self.leaderboard(course)
        names = [item["nickname"] for item in board["leaders"]]
        self.assertNotIn(account["nickname"], names, "离线补传的成绩不进公开榜")

    # ---- 榜单 ----

    def test_06_sample_threshold_and_ranking_math(self):
        start, peak, course = self.pair_course()
        self.seed_users(7, start, peak, course, duration_s=2400)
        board = self.leaderboard(course)
        self.assertEqual(7, board["sampleSize"])
        self.assertFalse(board["rankingAvailable"], "样本不足 8 人不显示名次")
        self.assertEqual([], board["leaders"])

        self.seed_users(1, start, peak, course, duration_s=1800)
        board = self.leaderboard(course)
        self.assertEqual(8, board["sampleSize"])
        self.assertTrue(board["rankingAvailable"])
        leaders = board["leaders"]
        self.assertEqual(1, leaders[0]["rank"])
        self.assertEqual(1800, leaders[0]["durationS"], "最快的人是第 1 名")
        self.assertEqual({2}, {item["rank"] for item in leaders[1:]},
                         "同秒并列同名次：2400 的七个人都是第 2")
        self.assertTrue(all("T" not in item["date"] for item in leaders),
                        "公开响应只给日期，不给精确时刻")
        self.assertTrue(all("nickname" in item and "durationS" in item for item in leaders))

        # 并列：再来两个 1800 秒的人 → 三个并列第 1，名单按名次 ≤3 取人（会多于三人）
        self.seed_users(2, start, peak, course, duration_s=1800)
        board = self.leaderboard(course)
        self.assertEqual(10, board["sampleSize"])
        fastest = [item for item in board["leaders"] if item["durationS"] == 1800]
        self.assertEqual(3, len(fastest))
        self.assertEqual({1}, {item["rank"] for item in fastest})

    def test_07_window_dedup_and_percentile(self):
        start, peak, course = self.pair_course()
        today = datetime.now(SHANGHAI).date()
        monday = today - timedelta(days=today.weekday())
        # 同一个账号本周走两次：榜单只取最快的一次
        users = self.seed_users(9, start, peak, course, duration_s=2400,
                                day=monday + timedelta(days=1))
        fast = users[0]
        V.sql("""UPDATE segment_efforts SET duration_s = 1200,
                    start_at = start_at + interval '1 day', end_at = end_at + interval '1 day'
              WHERE user_id=%d AND course_id=%d""" % (fast["uid"], course["id"]))
        board = self.leaderboard(course)
        self.assertEqual(9, board["sampleSize"], "同一人在同一窗口只算一次")
        self.assertEqual(1200, board["leaders"][0]["durationS"], "取更快的那次")
        self.assertEqual(1, board["leaders"][0]["rank"])

        # 登录用户看到自己的名次与百分位；百分位不算同用时的人
        account = V.new_account(self.http, PREFIX + "u")
        now = datetime.now(timezone.utc)
        self.walk(account, start, peak, start_minutes=20, end_minutes=3)
        self.recompute()
        board = self.leaderboard(course, account=account)
        self.assertEqual(1020, board["myBest"]["durationS"])
        self.assertEqual(10, board["sampleSize"])
        self.assertEqual(1, board["myBest"]["rank"])
        self.assertEqual(90, board["myBest"]["percentile"],
                         "百分位 = 更慢人数 / 有效人数 × 100（=9/10）")
        # 同用时不算更慢：再放一个和自己一样的用时，百分位不变
        self.seed_users(1, start, peak, course, duration_s=1020, day=today)
        board = self.leaderboard(course, account=account)
        self.assertEqual(11, board["sampleSize"])
        self.assertEqual(1, board["myBest"]["rank"])
        self.assertEqual(82, board["myBest"]["percentile"],
                         "同用时不计入更慢人数：仍是 9 个更慢的人，但分母变成 11")

        # 上一周的记录不进"本周"
        self.seed_users(1, start, peak, course, duration_s=1200, day=monday - timedelta(days=3))
        self.assertEqual(11, self.leaderboard(course)["sampleSize"], "上周成绩不进本周窗口")
        self.assertEqual(12, self.leaderboard(course, window="all")["sampleSize"])

    def test_08_leaderboard_setting_removes_from_denominator(self):
        start, peak, course = self.pair_course()
        seven_users = self.seed_users(8, start, peak, course, duration_s=2400)
        self.assertEqual(8, self.leaderboard(course)["sampleSize"])
        victim = seven_users[0]
        headers = victim["headers"]
        V.ok(self.http.patch("/api/me/leaderboard-settings", json={"enabled": False},
                             headers=headers), "关闭上榜")
        board = self.leaderboard(course)
        self.assertEqual(7, board["sampleSize"], "关闭后立即退出分母")
        self.assertFalse(board["rankingAvailable"], "样本掉回 7 人就不显示名次")
        V.ok(self.http.patch("/api/me/leaderboard-settings", json={"enabled": True},
                             headers=headers), "重新上榜")
        self.assertEqual(8, self.leaderboard(course)["sampleSize"])

    def test_09_course_listing_exposes_ranking_flag(self):
        start, peak, verified = self.pair_course()
        unverified = V.new_course(PREFIX, self.mountain, start["id"], peak["id"],
                                  ranking_enabled=False, min_duration_s=300,
                                  name=V.unique(PREFIX + "unverified"))
        rows = V.ok(self.http.get("/api/mountains/%d/courses" % self.mountain), "山头路线")
        flags = {row["id"]: row["rankingEnabled"] for row in rows}
        self.assertTrue(flags[verified["id"]])
        self.assertFalse(flags[unverified["id"]])
        self.assertEqual({"id", "name", "startPointId", "endPointId", "rankingEnabled"},
                         set(rows[0]))

    def test_10_broken_leaderboard_does_not_break_checkin(self):
        """榜单/配对故障时打卡必须照样成功，补偿作业跑完成绩自己出现。"""
        start, peak, course = self.pair_course()
        V.create_effort_failure_trigger(course["id"])
        account = V.new_account(self.http, PREFIX + "u")
        try:
            first, second = self.walk(account, start, peak, start_minutes=60, end_minutes=20)
        finally:
            V.drop_effort_failure_trigger()
        self.assertTrue(first["visitId"] and second["visitId"], "配对失败不能影响打卡")
        self.assertIsNone(self.effort_row(account["uid"], course),
                          "配对被注入的故障挡住了")
        output = self.recompute()
        self.assertIn("reconcile_efforts", output)
        self.assertIsNotNone(self.effort_row(account["uid"], course),
                             "补偿作业跑完，原凭证应该自己出现成绩")
        board = self.leaderboard(course, account=account)
        self.assertEqual(1, board["sampleSize"])


if __name__ == "__main__":
    unittest.main()
