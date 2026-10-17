"""统一山大王申请、审核、授权、山寨与移交的服务端验收。

覆盖计划 R1–R6 的关键边界：私有新山头在通过前不公开、重复负责人由数据库阻止、
并发双审批只有一次成功、负责人意见不直接授权、成员退出/移交后权限即时失效。
"""
from __future__ import annotations

import os
import sys
import unittest
import base64
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

PREFIX = "v3king"


class KingUnificationDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.reviewer = V.new_account(cls.http, PREFIX + "r")
        cls.reviewer2 = V.new_account(cls.http, PREFIX + "r2")
        for reviewer in (cls.reviewer, cls.reviewer2):
            V.sql("""INSERT INTO system_roles (user_id, role)
                VALUES (%d, 'collaboration_reviewer') ON CONFLICT DO NOTHING"""
                % reviewer["uid"])
        cls.owner = V.new_account(cls.http, PREFIX + "owner")
        cls.other = V.new_account(cls.http, PREFIX + "other")
        cls.member = V.new_account(cls.http, PREFIX + "member")
        cls.winner = None

    @classmethod
    def tearDownClass(cls):
        V.purge(PREFIX)
        cls.http.close()

    def body(self, **fields):
        data = {
            "targetKind": "new", "newPointType": "peak",
            "newRegion": "北京 · 门头沟",
            "newLocationText": "本地验收用位置，不对应真实路线",
            "newGpxRef": "{}",
            "reason": "我长期在这一片山域徒步，熟悉雨季路况，愿意持续维护岔路与补水点记录。",
            "expectations": "每月更新一次路况，重点标注滑坡与封路段，和成员一起核验轨迹。",
            "visitsPerMonth": 4, "nickname": "验收山友", "contact": "only-reviewer-visible"
        }
        data.update(fields)
        return data

    def submit(self, account, **fields):
        return self.http.post("/api/king-applications", json=self.body(**fields),
                              headers=account["headers"])

    def review(self, app_id, decision="approved", note="资料核过，同意这次申请",
               reviewer=None, **extra):
        body = {"decision": decision, "note": note}
        body.update(extra)
        return self.http.post("/api/admin/king-applications/%d/review" % app_id,
                              json=body,
                              headers=(reviewer or self.reviewer)["headers"])

    def existing_target(self, tag="old"):
        name = V.unique(PREFIX + tag)
        mid = V.new_mountain(PREFIX, name)
        point = V.new_point(PREFIX, kind="peak", mountain_id=mid, lat=31.0, lng=121.0,
                            name=name)
        V.sql("""INSERT INTO boards (board_type, mountain_id)
            VALUES ('summit', %d) ON CONFLICT (mountain_id) DO NOTHING""" % mid)
        return mid, point, name

    # ---- R2 / R3：新山头私有、审核通过一次性创建 ----
    def test_01_new_mountain_private_then_created(self):
        name = V.unique(PREFIX + "新峰")
        submitted = V.ok(self.submit(self.owner, newName=name), "提交新山头申请")
        self.assertEqual("pending", submitted["status"])
        self.assertEqual(0, V.sql_int("SELECT count(*) FROM mountains WHERE name = " + V.lit(name)),
                         "审核前新山头不能公开")
        queue = V.ok(self.http.get("/api/admin/king-applications?status=pending",
                                   headers=self.reviewer["headers"]), "审核队列")
        mine = [a for a in queue if a["id"] == submitted["id"]][0]
        self.assertEqual("only-reviewer-visible", mine["contact"])
        hidden = self.http.get("/api/king-applications/%d" % submitted["id"],
                               headers=self.other["headers"])
        self.assertEqual(403, hidden.status_code, "普通账号不能读别人的联系方式")
        detail = V.ok(self.http.get("/api/king-applications/%d" % submitted["id"],
                                    headers=self.owner["headers"]), "本人读申请")
        self.assertEqual("only-reviewer-visible", detail["contact"])
        approved = V.ok(self.review(submitted["id"]), "通过新山头申请")
        self.assertEqual("owner", approved["role"])
        mid = int(V.sql_value("SELECT id FROM mountains WHERE name = " + V.lit(name)))
        self.assertEqual("1", V.sql_value(
            "SELECT count(*) FROM mountain_members WHERE mountain_id=%d AND user_id=%d "
            "AND role='owner' AND status='active'" % (mid, self.owner["uid"])))
        self.assertEqual("1", V.sql_value(
            "SELECT count(*) FROM boards WHERE mountain_id=%d AND board_type='summit'" % mid))
        self.assertEqual("1", V.sql_value(
            "SELECT count(*) FROM short_links sl JOIN points p ON p.id=sl.point_id "
            "WHERE p.mountain_id=%d" % mid))
        # 数据库阻止第二个在任负责人
        self.assertTrue(V.sql_rejected(
            "INSERT INTO mountain_members (mountain_id,user_id,role,status) "
            "VALUES (%d,%d,'owner','active')" % (mid, self.other["uid"])))
        # 旧入口明确升级，不再直接授权
        old = self.http.post("/api/claims", json={
            "target_key": V.unique("oldclaim"), "target_name": "旧入口",
            "kind": "peak", "nickname": "旧入口"}, headers=self.other["headers"])
        self.assertEqual(410, old.status_code)
        self.assertEqual("UPGRADE_REQUIRED", V.error_code(old))

    def test_02_competition_confirmation_and_clan(self):
        name = V.unique(PREFIX + "竞争峰")
        first = V.ok(self.submit(self.owner, newName=name), "甲申请")
        second = V.ok(self.submit(self.other, newName=name), "乙申请")
        V.ok(self.review(first["id"]), "通过甲")
        second_row = V.sql_rows("SELECT status,target_mountain_id FROM master_applications "
                                "WHERE id=%d" % second["id"])[0]
        self.assertEqual("pending_confirmation", second_row[0], "竞争失败者必须本人确认后才能继续")
        self.assertNotEqual("", second_row[1])
        # 确认时还没有山寨：回到等待山寨，不授予成员权限
        confirmed = V.ok(self.http.post("/api/king-applications/%d/confirm-join" % second["id"],
                                       json={}, headers=self.other["headers"]), "本人确认")
        self.assertEqual("waiting_clan", confirmed["status"])
        mid = int(second_row[1])
        self.assertEqual("0", V.sql_value(
            "SELECT count(*) FROM mountain_members WHERE mountain_id=%d AND user_id=%d"
            % (mid, self.other["uid"])), "确认意向不等于成员身份")
        # 负责人组建山寨，平台审核成立
        clan = V.ok(self.http.post("/api/mountains/%d/clan-applications" % mid, json={
            "name": V.unique(PREFIX + "寨"),
            "intro": "这是一支愿意长期维护本山头留言与路况的协作小队，共享原有记录。",
            "collaborationPlan": "每月轮值核验留言，雨季重点检查滑坡与封路信息，及时发布公告。",
            "recruitRequirements": "能每月上山一次，熟悉本线路，愿意按平台规则留痕。"
        }, headers=self.owner["headers"]), "组建山寨")
        V.ok(self.http.post("/api/admin/clans/%d/review" % clan["id"], json={
            "decision": "approved", "note": "计划清楚，同意成立山寨"
        }, headers=self.reviewer["headers"]), "审核山寨")
        mine = V.ok(self.http.get("/api/me/king-applications",
                                  headers=self.other["headers"]), "我的申请")
        app = [a for a in mine if a["id"] == second["id"]][0]
        self.assertEqual("pending_confirmation", app["status"], "山寨成立后通知本人确认")
        V.ok(self.http.post("/api/king-applications/%d/confirm-join" % second["id"],
                            json={}, headers=self.other["headers"]), "确认继续")
        # 负责人意见只是参考
        V.ok(self.http.post("/api/clan-join-applications/%d/owner-opinion" % second["id"],
                            json={"opinion": "愿意接纳这位申请人一起维护本山头"},
                            headers=self.owner["headers"]), "写负责人意见")
        self.assertEqual("0", V.sql_value(
            "SELECT count(*) FROM mountain_members WHERE mountain_id=%d AND user_id=%d "
            "AND status='active'" % (mid, self.other["uid"])), "负责人意见不能直接授权")
        V.ok(self.review(second["id"], note="负责人意见已看，平台同意加入"),
             "平台审核加入")
        self.assertEqual("1", V.sql_value(
            "SELECT count(*) FROM mountain_members WHERE mountain_id=%d AND user_id=%d "
            "AND role='member' AND status='active'" % (mid, self.other["uid"])))
        boards = V.ok(self.http.get("/api/me/managed-boards", headers=self.other["headers"]),
                      "成员管理列表")
        self.assertTrue(any(b["mountainId"] == mid for b in boards), "获批后无需重登即可看到管理卡")
        # 负责人也不能读申请人的联系方式详情；只有本人与审核员可以
        owner_read = self.http.get("/api/king-applications/%d" % second["id"],
                                   headers=self.owner["headers"])
        self.assertEqual(403, owner_read.status_code)
        self.__class__.winner = {
            "mid": mid, "app": second, "clan": clan, "owner": self.owner,
            "member": self.other,
        }

    # ---- R3：需补充版本与旧接口 ----
    def test_03_needs_info_resubmit_keeps_version(self):
        name = V.unique(PREFIX + "补充峰")
        app = V.ok(self.submit(self.member, newName=name), "提交补充用例")
        V.ok(self.review(app["id"], decision="needs_info", note="请补充准确的 GPX 轨迹"),
             "要求补充")
        row = V.sql_rows("SELECT status,version FROM master_applications WHERE id=%d"
                         % app["id"])[0]
        self.assertEqual("needs_info", row[0])
        resubmit = dict(self.body(newName=name))
        resubmit["id"] = app["id"]
        resubmit["version"] = int(row[1])
        resubmit["expectations"] = "补充了完整 GPX 与雨季风险点，每月更新一次路况并逐条核验。"
        V.ok(self.http.post("/api/king-applications", json=resubmit,
                            headers=self.member["headers"]), "原申请重新提交")
        self.assertEqual("pending", V.sql_value(
            "SELECT status FROM master_applications WHERE id=%d" % app["id"]))
        versions = V.sql_int("SELECT count(*) FROM king_application_versions "
                             "WHERE application_id=%d" % app["id"])
        self.assertGreaterEqual(versions, 2, "原申请与重新提交都要保留版本")
        stale = dict(resubmit)
        stale["version"] = 1
        bad = self.http.post("/api/king-applications", json=stale,
                             headers=self.member["headers"])
        self.assertEqual(409, bad.status_code)
        self.assertEqual("APPLICATION_CLOSED", V.error_code(bad))

    # ---- R3：并发双审批 ----
    def test_04_concurrent_approval_only_one_owner(self):
        mid, point, _ = self.existing_target("并发")
        a = V.new_account(self.http, PREFIX + "ca")
        b = V.new_account(self.http, PREFIX + "cb")
        body = self.body(targetKind="existing", mountainId=mid, newName=None)
        first = V.ok(self.http.post("/api/king-applications", json=body,
                                    headers=a["headers"]), "并发甲提交")
        second = V.ok(self.http.post("/api/king-applications", json=body,
                                     headers=b["headers"]), "并发乙提交")

        def approve(item):
            with V.client() as client:
                return client.post("/api/admin/king-applications/%d/review" % item["id"],
                                   json={"decision": "approved",
                                         "note": "并发验收：资料完整，同意担任负责人"},
                                   headers=self.reviewer["headers"]).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = list(pool.map(approve, [first, second]))
        self.assertEqual([200, 409], sorted(codes), "两次并发批准只能成功一次")
        self.assertEqual("1", V.sql_value(
            "SELECT count(*) FROM mountain_members WHERE mountain_id=%d "
            "AND role='owner' AND status='active'" % mid))
        self.assertEqual("1", V.sql_value(
            "SELECT count(*) FROM mountain_members WHERE mountain_id=%d AND status='active'"
            % mid))

    def test_03b_draft_submit_without_client_version(self):
        name = V.unique(PREFIX + "草稿峰")
        draft = V.ok(self.http.post("/api/me/king-application-drafts", json=self.body(
            newName=name), headers=self.member["headers"]), "创建草稿")
        self.assertEqual("draft", draft["status"])
        payload = self.body(newName=name)
        payload["id"] = draft["id"]
        submitted = V.ok(self.http.post("/api/king-applications", json=payload,
                                        headers=self.member["headers"]),
                         "草稿不带版本号也能提交")
        self.assertEqual("pending", submitted["status"])

    # ---- R4 / R6：管理、隐藏、移交、退出 ----
    def test_05_managed_permissions_and_hide_reason(self):
        data = self.__class__.winner
        if not data:
            self.skipTest("依赖竞争与山寨用例")
        mid = data["mid"]
        outsider = V.new_account(self.http, PREFIX + "out")
        denied = self.http.get("/api/me/managed-boards/%d" % mid,
                               headers=outsider["headers"])
        self.assertEqual(403, denied.status_code)
        allowed = V.ok(self.http.get("/api/me/managed-boards/%d" % mid,
                                     headers=data["member"]["headers"]), "成员读管理详情")
        self.assertEqual("member", allowed["role"])
        point_id = int(V.sql_value(
            "SELECT id FROM points WHERE mountain_id=%d LIMIT 1" % mid))
        comment = V.ok(self.http.post("/api/points/%d/comments" % point_id,
                                     json={"text": "测试留言：北坡有暗冰，请慢行。"},
                                     headers=outsider["headers"]), "发留言")
        hidden = self.http.post("/api/comments/%d/hide" % comment["id"],
                                json={"reason": "未经核实的危险路况描述，先隐藏等待复核"},
                                headers=data["member"]["headers"])
        self.assertEqual(204, hidden.status_code)
        row = V.sql_rows("SELECT status,hidden_reason FROM comments WHERE id=%d"
                         % comment["id"])[0]
        self.assertEqual("hidden", row[0])
        self.assertIn("未经核实", row[1])

    def test_05b_duplicate_join_recruiting_and_self_review(self):
        data = self.__class__.winner
        if not data:
            self.skipTest("依赖竞争与山寨用例")
        clan_id = data["clan"]["id"]
        extra = V.new_account(self.http, PREFIX + "join")
        payload = {"message": "我愿意每月巡一次本线路，核验岔路与雨季风险，并参与留言处理。",
                   "visitsPerMonth": 2}
        first = V.ok(self.http.post("/api/clans/%d/join-applications" % clan_id,
                                    json=payload, headers=extra["headers"]), "首次加入")
        again = self.http.post("/api/clans/%d/join-applications" % clan_id,
                               json=payload, headers=extra["headers"])
        self.assertEqual(409, again.status_code, "重复加入不能产生第二份待审申请")
        V.ok(self.http.post("/api/clans/%d/recruiting" % clan_id,
                            json={"recruiting": False},
                            headers=data["owner"]["headers"]), "关闭招募")
        closed = self.http.post("/api/clans/%d/join-applications" % clan_id,
                                json=payload,
                                headers=V.new_account(self.http, PREFIX + "late")["headers"])
        self.assertEqual(409, closed.status_code)
        self.assertEqual("CLAN_NOT_RECRUITING", V.error_code(closed))
        # 审核员也不能审自己的申请
        own = V.ok(self.submit(self.reviewer, newName=V.unique(PREFIX + "自审")), "审核员自建申请")
        denied = self.review(own["id"], reviewer=self.reviewer)
        self.assertEqual(403, denied.status_code)
        self.assertEqual("SELF_REVIEW_FORBIDDEN", V.error_code(denied))

    def test_06_transfer_then_leave_revokes_immediately(self):
        data = self.__class__.winner
        if not data:
            self.skipTest("依赖竞争与山寨用例")
        mid = data["mid"]
        old_owner = data["owner"]
        successor = data["member"]
        req = V.ok(self.http.post("/api/mountains/%d/transfer-applications" % mid, json={
            "toUsername": successor["username"],
            "note": "我下个月离开本地，接任人熟悉线路与留言规则，愿意继续维护这座山。"
        }, headers=old_owner["headers"]), "发起移交")
        V.ok(self.http.post("/api/transfers/%d/accept" % req["id"], json={},
                            headers=successor["headers"]), "接任人确认")
        V.ok(self.http.post("/api/transfers/%d/review" % req["id"], json={
            "decision": "approved", "note": "接任人已确认，平台同意本次移交"
        }, headers=self.reviewer["headers"]), "平台审核移交")
        self.assertEqual(str(successor["uid"]), V.sql_value(
            "SELECT user_id FROM mountain_members WHERE mountain_id=%d "
            "AND role='owner' AND status='active'" % mid))
        replay = self.http.post("/api/transfers/%d/accept" % req["id"], json={},
                                headers=successor["headers"])
        self.assertEqual(409, replay.status_code, "已完成的移交不能重放")
        clan_id = data["clan"]["id"]
        V.ok(self.http.post("/api/clans/%d/leave" % clan_id, json={},
                            headers=old_owner["headers"]), "原负责人以成员身份退出")
        self.assertEqual("left", V.sql_value(
            "SELECT status FROM mountain_members WHERE mountain_id=%d AND user_id=%d"
            % (mid, old_owner["uid"])))
        boards = V.ok(self.http.get("/api/me/managed-boards",
                                    headers=old_owner["headers"]), "退出后的管理列表")
        self.assertFalse(any(b["mountainId"] == mid for b in boards), "退出后管理权限即时失效")
        V.ok(self.http.post("/api/admin/mountains/%d/takeover" % mid, json={
            "note": "负责人失联，平台接管并保留全部历史内容"
        }, headers=self.reviewer["headers"]), "平台接管")
        self.assertEqual("0", V.sql_value(
            "SELECT count(*) FROM mountain_members WHERE mountain_id=%d "
            "AND role='owner' AND status='active'" % mid))

    def test_06b_successor_can_decline_transfer(self):
        mid, point, _ = self.existing_target("拒接")
        current = V.new_account(self.http, PREFIX + "cur")
        successor = V.new_account(self.http, PREFIX + "succ")
        submitted = V.ok(self.http.post("/api/king-applications", json=self.body(
            targetKind="existing", mountainId=mid),
            headers=current["headers"]), "负责人申请")
        V.ok(self.review(submitted["id"]), "通过负责人申请")
        req = V.ok(self.http.post("/api/mountains/%d/transfer-applications" % mid, json={
            "toUsername": successor["username"],
            "note": "我近期无法继续巡山，希望把负责人身份交给熟悉线路的接任人。"
        }, headers=current["headers"]), "发起移交")
        declined = V.ok(self.http.post("/api/transfers/%d/decline" % req["id"], json={},
                                       headers=successor["headers"]), "接任人拒绝")
        self.assertEqual("cancelled", declined["status"])
        self.assertEqual(str(current["uid"]), V.sql_value(
            "SELECT user_id FROM mountain_members WHERE mountain_id=%d "
            "AND role='owner' AND status='active'" % mid))

    def test_07_search_and_old_review_retired(self):
        name = V.unique(PREFIX + "检索峰")
        app = V.ok(self.submit(self.member, newName=name), "检索用例申请")
        found = V.ok(self.http.get("/api/mountains/search?q=" + name + "&limit=10"),
                     "全库检索")
        self.assertEqual(0, len(found["items"]), "未审核的新山头不进入公开检索")
        V.ok(self.review(app["id"]), "通过检索用例")
        found = V.ok(self.http.get("/api/mountains/search?q=" + name + "&limit=10"),
                     "通过后检索")
        self.assertEqual(1, len(found["items"]))
        self.assertEqual(self.member["uid"], found["items"][0]["ownerId"])
        by_code = V.ok(self.http.get("/api/mountains/search?q=" +
                                     found["items"][0]["pointCode"] + "&limit=10"),
                       "按编号检索")
        self.assertTrue(any(x["mountainId"] == found["items"][0]["mountainId"]
                            for x in by_code["items"]))
        old = self.http.post("/api/admin/master-applications/%d/review" % app["id"],
                             json={"decision": "approved", "note": "旧入口不应授权"},
                             headers=self.reviewer["headers"])
        self.assertEqual(410, old.status_code)

    def test_08_route_cover_upload_review_and_recommendation(self):
        rec_mid = V.new_mountain(PREFIX, V.unique(PREFIX + "封面山"))
        V.new_point(PREFIX, kind="peak", mountain_id=rec_mid, lat=31.2, lng=121.3)
        V.sql("""INSERT INTO mountain_members
            (mountain_id,user_id,role,status,granted_by)
            VALUES (%d,%d,'owner','active',%d)"""
            % (rec_mid, self.member["uid"], self.reviewer["uid"]))
        slug = V.unique(PREFIX + "route")
        V.sql("""INSERT INTO routes
            (slug,name,km,up,down,hardest_level,path,profile,status)
            VALUES (%s,%s,1.2,120,110,'easy','[]'::jsonb,'[]'::jsonb,'published')"""
            % (V.lit(slug), V.lit("封面验收线路")))
        route_id = int(V.sql_value("SELECT id FROM routes WHERE slug=" + V.lit(slug)))
        V.sql("""INSERT INTO route_peaks (route_id,idx,km,altitude,rise,mountain_id)
            VALUES (%d,0,0.6,1200,120,%d)""" % (route_id, rec_mid))
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DA"
            "wMDAxAADCBYAG10BAgX0L9sAAAAASUVORK5CYII=")
        submitted = self.http.post(
            "/api/routes/%s/cover-submissions" % slug,
            files={"file": ("cover.png", png, "image/png")},
            data={"photographer": "验收拍摄者", "caption": "本地封面验收",
                  "licenseConfirmed": "true"},
            headers=self.owner["headers"])
        cover = V.ok(submitted, "投稿封面")
        self.assertEqual("pending", cover["status"])
        pending_file = self.http.get(cover["url"])
        self.assertEqual(404, pending_file.status_code, "未审核封面不能通过公开地址读取")
        rec = self.http.post("/api/routes/%s/cover-recommendations?submission_id=%d"
                             % (slug, cover["id"]),
                             json={"note": "这张照片确实来自本线路"},
                             headers=self.member["headers"])
        self.assertEqual(200, rec.status_code, "关联山头成员只能推荐，不能改官方封面")
        V.ok(self.http.post("/api/admin/cover-submissions/%d/review" % cover["id"],
                            json={"decision": "approved", "note": "真实性与授权已核对"},
                            headers=self.reviewer["headers"]), "审核封面")
        route = V.ok(self.http.get("/api/routes/" + slug), "路书详情")
        self.assertTrue(route["coverUrl"].startswith("/media/"))
        self.assertEqual("验收拍摄者", route["coverByline"])
        image = self.http.get(route["coverUrl"])
        self.assertEqual(200, image.status_code)
        self.assertTrue(image.headers["content-type"].startswith("image/jpeg"))
        bad = self.http.post(
            "/api/routes/%s/cover-submissions" % slug,
            files={"file": ("x.svg", b"<svg/>", "image/svg+xml")},
            data={"photographer": "验收", "licenseConfirmed": "true"},
            headers=self.owner["headers"])
        self.assertEqual(422, bad.status_code)
        self.assertEqual("COVER_TYPE_INVALID", V.error_code(bad))


if __name__ == "__main__":
    unittest.main()
