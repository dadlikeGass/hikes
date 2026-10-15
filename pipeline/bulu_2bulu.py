# -*- coding: utf-8 -*-
"""两步路（2bulu.com）访问工具：过 SafeLine 验证 + 取页面。

**能做到什么**
  两步路整站挂了 SafeLine（长亭）WAF：直接请求返回 468 + 一段 JS 验证页。
  这个模块把验证协议在 Python 里跑通：POST /challenge/v2/api/issue 拿题 →
  用官方 calc.js 里的纯 JS 兜底算法算答案 → POST /challenge/v2/api/verify 换
  `sl-challenge-jwt`，之后带这个 Cookie 就能正常打开首页 / 轨迹页 / 搜索页。

**做不到什么（要登录，站点自己的逻辑）**
  轨迹点数据与 GPX 下载对匿名用户一律拒绝，不是 WAF 的问题：
    · 页面里 `userId=""`、`operationCode=""` —— 服务端发现未登录就不下发这两个值；
      `/track/get_track_positions_list.htm`（画轨迹线用的坐标）缺 operationCode 直接报"系统异常"。
    · `var needLoginToView = true;` —— 前端弹"登录后才能在地图上查看轨迹线"。
    · 下载函数第一行 `if (!userId) { goLoginWeb(); return; }`，之后还要过阿里云滑块验证码；
      POST /track/downTrack.htm 匿名返回 {"CODE":40001}，GET /space/download_track.htm 返回 {"code":"1"}，
      这两个码在官方 JS 里都写着"去登录"。
    · 请求还要带 wasm 算出来的 `x-web-signature / x-web-cnonce / x-web-timestamp` 签名头
      （见 /js/common/encrypt_wrap.js + encryption.js 的 sign_v1），响应再用 decrypt_v1 解密。

  所以要用这个模块拿赛道轨迹，得先有登录态：把浏览器里 www.2bulu.com 的登录 Cookie
  交给下面 B2(cookie=...)，再在页面上下文里调它自己的 request.get()（签名由页面 JS 完成）。

用法：
    python3 pipeline/bulu_2bulu.py https://www.2bulu.com/track/t-xxxx.htm    # 打印标题
"""
import gzip
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36")
# 验证页里 SafeLineChallenge 的第一个参数（client_id），站点换 WAF 配置时要更新
CLIENT_ID = "7960059d8988444bba90a8aab7a55594_16"
CHALLENGE = "https://challenge.rivers.chaitin.cn"


def _open(req, timeout=30):
    r = urllib.request.urlopen(req, timeout=timeout)
    body = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        body = gzip.decompress(body)
    return body


def _post_json(url, body):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"User-Agent": UA, "Content-Type": "application/json",
                 "Accept": "*/*", "Referer": "https://www.2bulu.com/"}, method="POST")
    return json.loads(_open(req).decode())


def calc_f(nums):
    """calc.js 里 WebAssembly 不可用时的纯 JS 兜底算法，逐句照抄。"""
    t = 1
    r = (6 + len(nums) + sum(nums)) % 6 + 6
    for _ in range(r):
        t *= 6
    if t < 6666:
        t *= len(nums)
    if t > 0x3F940AA:
        t = t // len(nums)
    for o, v in enumerate(nums):
        t = (t + v ** 3) & 0xFFFFFFFF
        t ^= o
        t ^= int(v) + o
        t &= 0xFFFFFFFF
    out = []
    while t > 0:
        out.insert(0, t & 63)
        t >>= 6
    return out


def solve_waf():
    """过一次验证，返回 sl-challenge-jwt。"""
    iss = _post_json(CHALLENGE + "/challenge/v2/api/issue",
                     {"client_id": CLIENT_ID, "level": 1})
    d = iss["data"]
    ver = _post_json(CHALLENGE + "/challenge/v2/api/verify", {
        "issue_id": d["issue_id"], "result": calc_f(d["data"]), "serials": [],
        "client": {"userAgent": UA, "platform": "MacIntel", "language": "zh-CN,zh",
                   "vendor": "Google Inc.", "screen": [1512, 982],
                   "visitorId": "", "score": 0, "target": []}})
    if not ver.get("data", {}).get("verified"):
        raise RuntimeError("SafeLine 验证失败: %s" % ver)
    return ver["data"]["jwt"]


class B2:
    """带 WAF Cookie 的抓取器。cookie 参数可塞登录态（如 'sessionid=...'）。"""

    def __init__(self, cookie=""):
        self.jwt = solve_waf()
        self.extra = cookie
        self.jar = http.cookiejar.CookieJar()

    def _headers(self, referer=None):
        ck = "sl-challenge-jwt=%s; sl-challenge-server=cloud" % self.jwt
        if self.extra:
            ck += "; " + self.extra
        h = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9",
             "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
             "Cookie": ck}
        if referer:
            h["Referer"] = referer
        return h

    def get(self, url, referer=None, timeout=30):
        body = _open(urllib.request.Request(url, headers=self._headers(referer)), timeout).decode("utf-8", "ignore")
        if "slg-box" in body and len(body) < 60000:          # 又被打回验证页 → 重新过
            self.jwt = solve_waf()
            body = _open(urllib.request.Request(url, headers=self._headers(referer)), timeout).decode("utf-8", "ignore")
        return body


def title_of(html):
    t = re.findall(r"<title>(.*?)</title>", html, re.S)
    return (t[0] if t else "?").strip()


if __name__ == "__main__":
    b = B2(cookie="")
    for u in sys.argv[1:]:
        h = b.get(u, referer="https://www.2bulu.com/")
        print("%6d B  %s  <- %s" % (len(h), title_of(h), u))
