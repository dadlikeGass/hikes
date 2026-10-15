# 赛事官方赛道 GPX（UTMB 世界系列赛中国站 + 香港 + 国内头部赛）

从各赛事**官网**直接下载的官方赛道轨迹，统一为标准 GPX（`<trkpt>` 经纬度 + `<ele>` 海拔），
可直接导入 Suunto / Garmin / COROS / 两步路 / OsmAnd / Gaia / Strava。

- 共 **33 条**，覆盖 **8 场赛事**，16.9 万个轨迹点，20 MB
- 抓取时间：2026-10-12
- 元数据见 `manifest.json`（字段沿用 `tracks/manifest.json` 约定，另加 `event` / `category` / `official_*`）

## 收录清单

| 赛事 | 地点 | 档期 | 组别（文件数） | 官网 |
| --- | --- | --- | --- | --- |
| 云丘山越野赛 by UTMB | 山西·临汾乡宁 | 2026-10-16 | 100M / 100K / 50K / 30K / 20K / 10K×2 / 3K（8） | [mount-yun.utmb.world](https://mount-yun.utmb.world/races/100M) |
| 大境门古长城越野赛 by UTMB | 河北·张家口 | 2026-09-11 | DGW100 / CGW70 / MGW50 / NGW30（4） | [dajingmen.utmb.world](https://dajingmen.utmb.world/races/DGW100) |
| 大蜀道 100 越野赛 by UTMB | 四川·广元 | 2026-11-06 | 100K / 70K / 50K / 20K（4） | [shudao.utmb.world](https://shudao.utmb.world/races/100K) |
| 莫干山越野赛 by UTMB | 浙江·湖州德清 | 2026-04-10 | DMG 100M / CMG 100K / MMG 50K / EMG 20K（4） | [mogan.utmb.world](https://mogan.utmb.world/races/DMG) |
| 厦门越野赛 by UTMB | 福建·厦门 | 2026-03-14 | 100K / 50K / 20K（3） | [xiamen.utmb.world](https://xiamen.utmb.world/races/100K) |
| 宁海越野挑战赛 | 浙江·宁波宁海 | 2026-11-13 | UTNH 105K / CNH 60K / YNH 25K（3） | [ninghai.utmb.world](https://ninghai.utmb.world/races/utnh) |
| TransLantau 大屿山 by UTMB | 香港·大屿山 | 2026-11-13 | TL100 / TL50 / TL25 / TL15（4） | [translantau.utmb.world](https://translantau.utmb.world/races/tl100) |
| 香港 100（HK100） | 香港 | 2027-01-21 | Full / Half / Third（3） | [hk100ultra.com](https://hk100ultra.com/hk100/) |

## 数据口径

- `distance_km`：按轨迹点 haversine 重算的距离。
- `gain_m`：用 `tracks/build_app_data.py` 同款去噪算法（窗口平滑 + 阈值累计）从原始海拔重算。
- `gain_raw_m`：原始海拔逐点累加，未去噪（会明显偏高）。
- `official_distance_m` / `official_gain_m`：组委会官网公布的组别数据，**以官方为准**。

⚠️ **云丘山、大境门两场**的官方 GPX 海拔抖动较大，去噪后仍显著高于官方公布值
（例：云丘山 30K 去噪 7989 m vs 官方 1802 m），`manifest.json` 里已用 `gain_note` 标注。
这两场若用于展示，请取 `official_gain_m`。

香港 100 的 GPX 来自官网路线图页（由 plotaroute 绘制，非 GPS 记录），
因此算出 95.3 km，短于官方的 100 km 标称距离。

## 命名与文件

```
tracks/races/<site>-<code>.gpx      # 例：mount-yun-100m.gpx、translantau-tl100.gpx
tracks/races/hk100-full.gpx         # 香港 100 三个组别
tracks/races/manifest.json          # 33 条元数据
```

## 复现

UTMB 各站组别页（`https://<site>.utmb.world/races/<code>`）的页面 JSON 里带 `gpxUrl`
字段，直接指向 CDN 上的官方 GPX：

```bash
# 组别页列表
curl -s https://mount-yun.utmb.world/sitemap.xml | grep -o '<loc>[^<]*races/[^<]*</loc>'
# 组别页内的官方轨迹地址
curl -s https://mount-yun.utmb.world/zh-Hans/races/100M | grep -o '"gpxUrl":"[^"]*"'
# 下载（CDN 对 urllib 会截断连接，用 curl）
curl -sL --http1.1 --compressed -o mount-yun-100m.gpx "<gpxUrl>"
```

HK100 三个组别的 GPX 在官网组别页的路线图旁（`/hk100/`、`/the-half/`、`/the-third/`）。

## 还没拿到的国内头部赛事（没有公开的官方 GPX 下载）

以下赛事的官网要么没有轨迹下载，要么站点在本机不可达；它们的官方轨迹基本走
**官方公众号文章 → 两步路·户外助手关键词搜索**（下载需登录 + 过滑块，匿名抓不了），
或「第一赛道」等自有 App：

| 赛事 | 情况 |
| --- | --- |
| 崇礼 168 超级越野赛 | 官网 chongli-ultra.cn 是 SPA，未见公开轨迹接口；轨迹发在「崇礼168超级越野赛」「三夫赛事」公众号 |
| 柴古唐斯·括苍越野赛 | 无独立官网，赛道轨迹在公众号 / 两步路关键词（如「柴古唐斯 括苍」） |
| 武功山越野赛 | 赛道数据与轨迹由「武功山越野」「第一赛道」公众号赛前一周发布 |
| 龙脊梯田百公里跑山赛 | 历年轨迹走两步路，关键词「龙脊梯田跑山赛」 |
| 梅里 100 极限耐力赛 | 官网 utrma.com 在本机不可达，跟踪迹走两步路 |
| 环四姑娘山超级越野跑 | 无官网轨迹下载 |
| 大武夷超级山径赛 | 官网 wuyitrail.com 为 Nuxt 站点，页面不含轨迹文件 |
| 贡嘎 100 冰川极限挑战赛 / 环玉龙雪山 / 长江三峡（巫山）/ 江山 100 / 杭州大宋 108 / 环五台山 | 均无公开官方 GPX，跟随公众号或两步路 |

## 版权与使用

轨迹版权归各赛事组委会所有，此处仅作路线参考与产品演示；引用请保留来源链接。
赛事轨迹会逐年调整，出行前请以组委会当年发布的最终轨迹为准。
