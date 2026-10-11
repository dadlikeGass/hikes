# 到此一游 · API 契约 v1（1.0 范围）

这份契约跟跨端方案无关：小程序 / H5 / 维护台共用一套。
所有接口前缀 `/api`，返回 JSON。示例用 ```json 代码块标注。

## 通用约定

**鉴权**：除 `POST /api/auth/wechat` 和 `GET /p/{code}` 外全部需要
`Authorization: Bearer <token>`。JWT 有效期 7 天，用 `POST /api/auth/refresh` 续期。

**成功**：直接返回数据体，不套 `{code, data}`。

**失败**：
```json
{ "error": { "code": "POINT_NOT_FOUND", "message": "点位不存在" } }
```
状态码语义化：400 参数错 / 401 未登录 / 403 无权限 / 404 不存在 / 409 冲突 / 429 限流 / 500 服务端错。

**分页**：游标式 `?cursor=&limit=20`，返回 `{ items, nextCursor }`。不用 offset——
留言会不断新增，offset 会重复。

**幂等**：`POST /api/points/{id}/visit` 带 `Idempotency-Key`，弱网重试不重复计数。

---

## 1. 认证

### POST /api/auth/wechat
两端共用，只有 code 来源不同：小程序用 `wx.login()` 的 code，H5 用网页授权的 code。

```json
// 请求
{ "code": "081Abc...", "platform": "miniapp", "nickname": "阿甘" }
// 响应
{ "token": "eyJ...", "refreshToken": "eyJ...",
  "user": { "id": "u_1", "nickname": "阿甘", "isNew": true } }
```
**先发 token，昵称后面再补。** 扫码进来的人不该被注册表单拦住。

### GET /api/me
```json
{ "id": "u_1", "nickname": "阿甘", "visitedCount": 12, "claimedPoints": 1 }
```

---

## 2. 短链（服务端路由，不是 API）

### GET /p/{code}
二维码里印的就是这个。按 UA 分流：

| 环境 | 行为 |
| --- | --- |
| 微信内 + 已配小程序 | 跳小程序中转页（路径固定 `pages/scan?c={code}`，参数可变） |
| 微信内 / 系统浏览器 | 302 到 H5 `/#/p/{code}` |
| 桌面浏览器 | "用手机扫码"页 + 二维码 + 编号输入框 |

`{code}` 一旦生成不可变——这是标牌不用重印的前提。

---

## 3. 点位

### GET /api/points/{code}
落地页首屏所需的全部数据，一次返回。

```json
{
  "id": "pt_1", "code": "QSD02", "type": "junction",
  "name": "林道岔口", "routeName": "溪谷森林步道",
  "indexInRoute": 2, "totalInRoute": 5,
  "level": "mid", "altitude": null,
  "guide": { "arrow": "↰", "title": "左转上山，别跟右边那条宽路",
             "desc": "右侧是林场作业道", "next": "下一段 · 溪谷平台 1.8 km" },
  "visitCount": 176,
  "myVisit": { "seq": 128, "count": 2 },
  "comments": { "count": 12, "preview": [ "Comment", "Comment" ] },
  "topComment": "Comment"
}
```
`myVisit` 未到访为 `null`。`topComment` 是落地页第一屏要展示的那一条。

---

## 4. 打卡

### POST /api/points/{id}/visit
```json
// 请求
{ "source": "scan", "clientTime": "2026-10-11T05:20:00Z" }
// 响应
{ "seq": 129, "isFirstVisit": false, "myVisitCount": 3,
  "isNewRecord": false, "message": "你是第 129 位在这里留下痕迹的人" }
```
**去重规则**：同一用户 + 同一点位 + 同一天只计一次（返回已存在的 seq），跨天才 +1。

### GET /api/me/visits?cursor=&limit=
```json
{ "items": [{ "pointId": "pt_1", "name": "林道岔口", "seq": 128,
  "at": "2026-09-21T03:12:00Z", "level": "mid" }], "nextCursor": null }
```

---

## 5. 留言

### GET /api/points/{id}/comments?cursor=&limit=20
**排序规则固定，前端不要再排**：
1. 维护人的留言置顶
2. 然后按净分 `like - bad` 降序
3. 同分按时间倒序

```json
{
  "items": [{
    "id": "c_1", "text": "下雨天石阶很滑，我走的左侧土路。",
    "user": { "id": "u_2", "nickname": "小鱼" },
    "role": "member", "like": 4, "bad": 1, "myVote": null,
    "status": "normal", "at": "2026-10-10T09:00:00Z"
  }],
  "nextCursor": null
}
```
`role` 取 `member | maintainer`；`myVote` 取 `null | "like" | "bad"`。

**`status = flagged` 的触发条件：`bad >= 3 且 bad > like`。**
不删除，只灰度显示——路况信息过时了需要留痕。

### POST /api/points/{id}/comments
```json
{ "text": "上面风大，记得带件外套。" }
```
v1 **只收纯文本，最多 200 字**，图片走 v1.1。

### POST /api/comments/{id}/vote
```json
{ "value": "like" }
```
`value` 取 `"like" | "bad" | null`，`null` 表示取消投票。

---

## 6. 路书

### GET /api/routes?cursor=&level=&q=
```json
{ "items": [{ "id": "rt_1", "name": "三峰连穿",
  "sub": "大觉寺·鹫峰·阳台山·妙峰山",
  "km": 21.1, "up": 1948, "down": 1951, "level": "hard",
  "peakCount": 5, "segmentCount": 6, "visitCount": 86 }],
  "nextCursor": null }
```
`up` / `down` 用**原始高程 + 3 m 滞回**计算，不用平滑后的高程（踩过的坑）。

### GET /api/routes/{id}
```json
{
  "id": "rt_1", "name": "三峰连穿", "km": 21.1, "up": 1948, "down": 1951,
  "level": "hard",
  "path": [[0.12, 0.44]],
  "profile": [0.0, 0.03],
  "peaks": [{ "index": 0, "km": 4.9, "altitude": 1092, "rise": 971 }],
  "segments": [{
    "no": 1, "fromKm": 0.0, "toKm": 4.9, "km": 4.9, "rise": 971, "pct": 20,
    "level": "hard", "kind": "climb",
    "source": "auto", "confirmed": false, "commentCount": 2
  }]
}
```
`path` / `profile` 是归一化 0–1 的数组，前端直接喂给 `<RouteMap>` 画 SVG，
服务端不做投影——**换地图方案时前端不用改后端**。

**`source`（auto/manual）和 `confirmed` 是必须的**：自动算出来的是基础判断，
维护人确认后才算正式数据。

---

## 7. 埋点

### POST /api/events
```json
{ "name": "scan_landing", "props": { "pointCode": "QSD02" }, "ts": 1760000000000 }
```
批量上报传数组。三个验证问题全靠它：

- **会不会扫码** → `scan_landing` 去重人数
- **会不会留言** → `comment` / `visit` 人数比
- **会不会反复打开** → `app_open` 的 7 日回访率（按 user_id 去重）

---

## 附：核心枚举

- `Level`：`easy | mid | hard | hidden` —— **hidden 只能人工设定，不自动产生**
- `PointType`：`peak | junction | trailhead`
- `Role`：`member | maintainer`
