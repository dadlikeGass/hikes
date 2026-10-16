# 封存的前端（B / C / D）

> 2026-10-15 封存，用户明确要求。
> **这里的任何文件在获得用户口头明确许可之前不得修改、恢复、部署或作为实现参考直接搬运。**
> 解除封存需要用户逐项说明，不能因为"顺手需要"就打开。

## 为什么封

仓库里先后存在四套前端，其中三套是历史版本或一次性产物。保留在服务目录里会造成三个问题：同一个页面有多份实现，改一处不知道另一处是否也要改；被挂到公网路径上等于多开一个入口；新功能的落点会被旧结构带偏。

## 封了什么

### `frontend-b-static/` —— 静态多页前端（上一代主线）

原来的 `app/web/` 根目录，曾在 `/` 提供服务，底部导航为「路书 / 山头·岔路 / 扫一扫 / 消息 / 我」。

| 文件 | 原路径 | 说明 |
| --- | --- | --- |
| `home.html` | `app/web/home.html` | 曾是 `/` 的首页 |
| `routes.html` | `app/web/routes.html` | 路书 |
| `places.html` | `app/web/places.html` | 山头·岔路 |
| `me.html` | `app/web/me.html` | 我 |
| `admin.html` | `app/web/admin.html` | 维护台 |
| `index.html` | `app/web/index.html` | 点位页，曾是 `/index.html?code=xxx` 落地页 |
| `nav.js` | `app/web/nav.js` | 这套的底部导航 |
| `guard.js` | `app/web/guard.js` | 这套的页面守卫与示例码提示 |

### `frontend-c-prototypes/` —— 静态视觉原型

`app/web/pages/*.html` 与 `app/web/design.css`。10 月 11–12 日的纯视觉稿，从未接入数据。其中 `arrive.html` 含用时榜、第 N 位、留给后来者的话等早期设计，**只作历史参考，不是当前实现依据**。

### `frontend-d-sanfeng/` —— 三峰连穿分级预览

`app/sanfeng.html`，一次性预览页，无数据接入。

## 没封什么（重要）

以下内容仍留在原来的服务路径上，**不属于封存范围，正常维护**：

- `app/web/privacy.html`、`terms.html`、`rules.html` —— 三份合规文本，仍由 `/privacy.html` 等提供
- `app/web/robots.txt` —— 搜索引擎规则
- `app/web/terrain/` —— 离线 DEM 地形底图，**当前主线 SPA 也在用**（`/terrain/{slug}.png`），不是 B 的专属资产
- `app/` —— 主线 SPA，挂在 `/app/`

## 现在的唯一前端

`app/`（SPA），入口 `/app/`。根地址 `/` 已改为 302 跳转到 `/app/`，实现见 `server/app/main.py` 的 `index_page`。

## 会写回封存区域的东西

| 位置 | 风险 |
| --- | --- |
| `pipeline/extract_design.py` | 输出目录写的是 `app/web/design.css` 与 `app/web/pages/`，**运行它会重新在服务目录里生成被封存的原型**。要跑先征得用户同意，或先把输出目录改掉。 |
| `server/seeds/seed.py` | 遗留脚本，读 `app/js/route-sanfeng.js`，与 D 有关，已被 `seed_routes.py` 取代。 |

## 怎么解封

用户明确许可后，按原路径 `git mv` 回去即可，历史都在 git 里，没有内容丢失。解封后必须同时回答：它重新挂在哪个公网路径上、和主线的关系是什么、旧链接怎么处理。
