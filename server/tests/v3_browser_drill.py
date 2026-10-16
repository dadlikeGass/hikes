"""T4/T6/T7 的浏览器侧验收（计划里的 v3_browser_checklist 走自动化能做的部分）。

用 Playwright(Python) 驱动真实 Chromium，对隔离环境里的 /app/ 页面做：

* 断网时"我到了"必须落进本机队列，不许假报成功；恢复联网后必须只入库一条；
* 拒定位权限、本机存储不可用时都要说清原因，且不留半截记录；
* Service Worker 只缓存静态壳，/api/me 与信件响应不进缓存；
* 首页在 390px / 1440px 两个宽度下的主动作与摘要；
* 私人未来信：封存正文不出现在 DOM 里，open 模式可读。

前置：隔离环境在跑，且本机装了 playwright + chromium：

    python3 -m pip install --user playwright && python3 -m playwright install chromium

真机 / 真实山顶的定位权限与半径校准仍然要在现场做，自动化代替不了（见 T3 通过标准）。
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

import v3_common as V  # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - 环境没装就跳过
    sync_playwright = None

PREFIX = "v3t4"
APP = "/app/"


@unittest.skipIf(sync_playwright is None,
                 "没有 playwright：python3 -m pip install --user playwright && "
                 "python3 -m playwright install chromium")
class BrowserDrill(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = V.client()
        V.prepare_env(cls.http)
        cls.mountain = V.new_mountain(PREFIX, V.unique(PREFIX + "shan"))
        cls.peak = V.new_point(PREFIX, kind="peak", lat=39.99, lng=116.17,
                               mountain_id=cls.mountain)
        cls.other = V.new_point(PREFIX, kind="peak", lat=39.95, lng=116.10,
                                mountain_id=cls.mountain)
        cls.playwright = sync_playwright().start()

    @classmethod
    def tearDownClass(cls):
        cls.playwright.stop()
        V.purge(PREFIX)
        cls.http.close()

    def browser(self, **kwargs):
        kwargs.setdefault("headless", True)
        return self.playwright.chromium.launch(**kwargs)

    def page(self, browser, *, viewport=None, storage=True, indexeddb=True):
        context = browser.new_context(
            viewport=viewport or {"width": 390, "height": 844},
            base_url=V.base_url(), locale="zh-CN")
        if not indexeddb:
            # 模拟"本机存储用不了"（隐身模式 / 存储被禁）
            context.add_init_script("Object.defineProperty(window, 'indexedDB', "
                                    "{get: function () { return undefined; }});")
        page = context.new_page()
        return context, page

    def arrive(self, page, code, wait_for="text=我到了"):
        page.goto(V.base_url() + APP + "#/arrive/p-" + code)
        page.wait_for_selector(wait_for, timeout=20000)

    # ---- T4：断网打卡与队列 ----

    def test_01_offline_checkin_queues_then_syncs_once(self):
        browser = self.browser()
        try:
            context, page = self.page(browser)
            page.goto(V.base_url() + APP + "#/home")
            page.wait_for_selector("a.home-primary", timeout=20000)
            # 先在线加载一次页面，让 Service Worker 与游客身份就位
            self.arrive(page, self.peak["code"])
            context.set_offline(True)
            page.click("button:has-text('我到了')")
            page.wait_for_selector("text=已保存在本机，待同步", timeout=15000)
            self.assertEqual(0, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                          % self.peak["id"]),
                             "断网时服务器不该有任何到访")
            queued = page.evaluate("""() => new Promise((resolve) => {
                const request = indexedDB.open('hikes-checkins-v1', 1);
                request.onsuccess = () => {
                  const store = request.result.transaction('pending').objectStore('pending');
                  const all = store.getAll();
                  all.onsuccess = () => resolve(all.result);
                };
              })""")
            self.assertEqual(1, len(queued), "断网打卡要落进本机队列")
            self.assertEqual("pending", queued[0]["status"])
            self.assertTrue(queued[0]["payload"]["occurredAt"], "现场时间要一起存下来")
            self.assertEqual(self.peak["code"], queued[0]["pointSnapshot"]["code"])

            # 恢复联网 → 不管是自动同步还是点重试，最终都要把记录送上去且只送一条
            context.set_offline(False)
            page.click("[data-act='sync-checkins']")
            page.wait_for_function("""() => new Promise((resolve) => {
                const request = indexedDB.open('hikes-checkins-v1', 1);
                request.onsuccess = () => {
                  const store = request.result.transaction('pending').objectStore('pending');
                  const all = store.getAll();
                  all.onsuccess = () => resolve(all.result.length === 0);
                };
              })""", timeout=25000)
            self.assertEqual(1, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                          % self.peak["id"]),
                             "同步必须只入库一条")
            left = page.evaluate("""() => new Promise((resolve) => {
                const request = indexedDB.open('hikes-checkins-v1', 1);
                request.onsuccess = () => {
                  const store = request.result.transaction('pending').objectStore('pending');
                  const all = store.getAll();
                  all.onsuccess = () => resolve(all.result.length);
                };
              })""")
            self.assertEqual(0, left, "同步成功后本机队列要清空")
            self.assertTrue("已同步" in page.content() or "没有待同步" in page.content(),
                            "同步完成后要有明确反馈")
        finally:
            browser.close()

    def test_02_refused_geolocation_is_explained(self):
        browser = self.browser()
        try:
            target = V.new_point(PREFIX, kind="peak", lat=39.99, lng=116.17,
                                 mountain_id=self.mountain)
            context, page = self.page(browser)
            # 不授权定位：浏览器直接给权限错误
            page.goto(V.base_url() + APP + "#/home")
            page.wait_for_selector("text=附近定位打卡", timeout=20000)
            page.click("text=附近定位打卡")
            page.wait_for_selector("text=定位", timeout=20000)
            body = page.content()
            self.assertIn("定位", body)
            self.assertNotIn("已到达", body, "拿不到定位时不能出现成功凭证")
            self.assertEqual(0, V.sql_int("SELECT count(*) FROM visits WHERE point_id=%d"
                                          % target["id"]),
                             "拒定位时不能产生任何到访")
        finally:
            browser.close()

    def test_03_storage_failure_never_claims_saved(self):
        browser = self.browser()
        try:
            context, page = self.page(browser, indexeddb=False)
            page.goto(V.base_url() + APP + "#/home")
            page.wait_for_selector("a.home-primary", timeout=20000)
            self.arrive(page, self.other["code"])
            context.set_offline(True)
            page.click("button:has-text('我到了')")
            page.wait_for_selector("text=本机保存失败", timeout=20000)
            self.assertNotIn("已保存在本机", page.content(),
                             "存不下来就不能说已保存")
        finally:
            browser.close()

    def test_04_service_worker_does_not_cache_private_responses(self):
        browser = self.browser()
        try:
            account = V.new_account(self.http, PREFIX + "u")
            context, page = self.page(browser)
            page.goto(V.base_url() + APP + "#/me/letters")
            page.evaluate("""(token) => {
                localStorage.setItem('hikes.auth.token', token);
            }""", account["token"])
            page.goto(V.base_url() + APP + "#/me/letters")
            page.wait_for_selector("text=写给未来的自己", timeout=20000)
            page.evaluate("navigator.serviceWorker.ready")
            caches = page.evaluate("""() => caches.keys().then((keys) => Promise.all(
                keys.map((key) => caches.open(key).then((cache) => cache.keys()
                  .then((requests) => requests.map((r) => key + ' :: ' + r.url))))))
                .then((groups) => [].concat.apply([], groups))""")
            private = [entry for entry in caches
                       if "/api/me" in entry or "/api/guest" in entry or "letters" in entry]
            self.assertEqual([], private, "私人响应不能进缓存：%s" % private)
        finally:
            browser.close()

    # ---- T6：首页布局 ----

    def test_05_home_layout_at_two_widths(self):
        browser = self.browser()
        try:
            account = V.new_account(self.http, PREFIX + "u")
            now = datetime.now(timezone.utc)
            V.ok(V.checkin_account(self.http, account, self.peak["id"], source="scan",
                                   clientUuid=V.action_uuid(),
                                   occurredAt=(now - timedelta(minutes=5)).isoformat()),
                 "造一条到访")
            for width in (390, 1440):
                context, page = self.page(browser, viewport={"width": width, "height": 900})
                page.goto(V.base_url() + APP + "#/home")
                page.evaluate("(token) => localStorage.setItem('hikes.auth.token', token)",
                              account["token"])
                page.goto(V.base_url() + APP + "#/home")
                page.wait_for_selector("text=查看全部", timeout=20000)
                body = page.content()
                for expected in ("扫码打卡", "附近定位打卡", "查看全部"):
                    self.assertIn(expected, body, "%spx 首页应出现 %s" % (width, expected))
                self.assertNotIn("这里可以玩什么", body, "首页不再放大块功能格")
                # 主动作要在第一屏
                box = page.locator("text=扫码打卡").first.bounding_box()
                self.assertLess(box["y"], 900, "主动作必须在首屏内")
                page.screenshot(path="/tmp/v3-home-%d.png" % width, full_page=True)
                context.close()
        finally:
            browser.close()

    # ---- T7：私人信界面 ----

    def test_06_letters_ui_keeps_sealed_body_off_page(self):
        browser = self.browser()
        try:
            account = V.new_account(self.http, PREFIX + "u")
            secret = "封存正文 " + account["username"]
            sealed = V.ok(self.http.post("/api/me/letters",
                                        json={"text": secret, "mode": "date", "years": 5},
                                        headers=account["headers"]), "写封存信")
            open_letter = V.ok(self.http.post("/api/me/letters",
                                              json={"text": "现在就能看 " + account["username"],
                                                    "mode": "open"},
                                              headers=account["headers"]), "写可读信")
            context, page = self.page(browser)
            page.goto(V.base_url() + APP + "#/me/letters")
            page.evaluate("(token) => localStorage.setItem('hikes.auth.token', token)",
                          account["token"])
            page.goto(V.base_url() + APP + "#/me/letters")
            page.wait_for_selector("text=写给未来的自己", timeout=20000)
            body = page.content()
            self.assertIn("封存中", body)
            self.assertNotIn(secret, body, "未解锁的正文不能出现在页面上")
            self.assertIn("现在就能看", body, "open 模式的信要能直接读")
            self.assertIn(str(sealed["unlockAt"])[:10], body, "要显示到期日期")
            # 页面源码 / 缓存里也不该有封存正文
            self.assertNotIn(secret, page.evaluate("document.documentElement.outerHTML"))
        finally:
            browser.close()

    def test_07_checkin_page_offers_no_forced_signup(self):
        browser = self.browser()
        try:
            context, page = self.page(browser)
            self.arrive(page, self.peak["code"])
            body = page.content()
            self.assertIn("不用注册", body, "到达页要说明可以不注册")
            page.click("button:has-text('我到了')")
            page.wait_for_selector("text=已到达", timeout=20000)
            after = page.content()
            self.assertIn("该点位第", after, "凭证要按记录序号说明，而不是第几个人")
            self.assertNotIn("第 1 位在这里留下痕迹的人", after)
        finally:
            browser.close()


    # ---- T5：选中山头后的次级用时榜 ----

    def test_08_mountain_page_shows_leaderboard_module(self):
        start = V.new_point(PREFIX, kind="trailhead", lat=39.95, lng=116.10,
                            mountain_id=self.mountain)
        peak = V.new_point(PREFIX, kind="peak", lat=39.99, lng=116.17,
                           mountain_id=self.mountain)
        V.new_course(PREFIX, self.mountain, start["id"], peak["id"],
                     ranking_enabled=True, min_duration_s=300)
        browser = self.browser()
        try:
            context, page = self.page(browser)
            page.goto(V.base_url() + APP + "#/peaks/p-" + peak["code"])
            page.wait_for_selector("text=登顶用时榜", timeout=25000)
            # 榜单是按需加载的：等它的真实结果，别读"正在读取"那一帧
            page.wait_for_selector("text=有效样本不足 8 人", timeout=25000)
            body = page.content()
            self.assertIn("本周", body, "榜单要有周/月/年/历史的窗口切换")
            self.assertIn("有效样本不足 8 人", body,
                          "样本不足时不给名次，只给解释")
            self.assertNotIn("第 1 名", body)
            context.close()
        finally:
            browser.close()

    # ---- 过期令牌：退回游客身份，而不是显示"读不到" ----

    def test_09_stale_token_falls_back_to_guest(self):
        browser = self.browser()
        try:
            context, page = self.page(browser)
            page.goto(V.base_url() + APP + "#/home")
            page.wait_for_selector("a.home-primary", timeout=20000)
            # 本地塞一个过期的令牌（真实用户切换环境后就是这个状态）
            page.evaluate("""() => {
                localStorage.setItem('hikes.auth.token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
                  + 'eyJzdWIiOiI5OTk5OTk5IiwiZXhwIjoxfQ.not-a-real-signature');
                localStorage.setItem('hikes.auth.userId', '9999999');
            }""")
            page.reload()
            page.wait_for_selector("text=登录状态已过期", timeout=20000)
            body = page.content()
            self.assertNotIn("暂时无法读取到访人数", body,
                             "过期令牌要退回游客身份，而不是报读不到")
            cleared = page.evaluate("() => localStorage.getItem('hikes.auth.token')")
            self.assertIsNone(cleared, "过期令牌要被清掉")
            context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    unittest.main()
