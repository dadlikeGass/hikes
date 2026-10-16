# 数据管线（合并后的唯一形态）

> 2026-10-15 合并归档。过去的 `build_routes_cn.py` / `build_races.py` /
> `build_checkpoints.py` 三份重复脚本已并入 `pipeline/build.py`；
> 三份 `seed_routes*.py` 合并成一个。本文是运行手册，算法取舍见
> [PIPELINE_REVIEW.md](./PIPELINE_REVIEW.md)，字段契约见 [API.md](./API.md)。

## 一条链，五个环节

```text
tracks/ 原始 GPX / KML + 各来源 manifest
  → ① pipeline/build.py            算法核心 + 来源适配 + 赛事打卡点
       out/routes.json            12 条北京山野徒步/越野
       out/routes_cn.json         52 条全国区域路线
       out/race_routes.json       93 条赛事赛道
       out/race_checkpoints.json  44 条赛道的 279 个官方打卡点
       out/_meta.json             算法版本、生成时间、条数与不评级段统计
  → ② pipeline/build_terrain.py    DEM 底图（晕渲 + 等高线）
       app/web/terrain/<slug>.png + <slug>.json
  → ③ server/seeds/seed_routes.py 入库（routes / route_segments / route_peaks）
     server/seeds/seed_race_checkpoints.py  赛事打卡点入库 + 给山顶标最近 CP
  → ④ API：/api/routes、/api/routes/{slug}
  → ⑤ 前端：app/web/routes.html（轨迹图 / 坡度色带 / 分段表）、home.html
```

峰名候选（`pipeline/match_peaks*.py`、`import_*.py`）是**旁路**：只写候选
（`route_peak_candidates`），不改正式峰名、不进这条主链。

`pipeline/import_china_peaks.py` 也是旁路，但只写**山头库**（`mountains` 的档案列），
不碰线路、分段与峰名候选。见「山头档案：100 座热门徒步登山山峰」。

## ① 算法与来源适配：pipeline/build.py

```bash
python3 pipeline/build.py                    # 三个来源全跑
python3 pipeline/build.py --source races     # 只跑赛事（含打卡点）
python3 pipeline/build.py --only fff-99984929 sanfeng
```

`--only` 是筛选运行：它只写 `<来源>.partial.json`，不会把整份正式产物覆盖成一小撮，
也不写 `_meta.json` 台账。

- 输入：`tracks/*.gpx`、`tracks/routes-cn/*.gpx`、`tracks/races/*.gpx|*.kml`
  加各自的 `manifest.json`（名称、城市、来源、赛事年份/官方距离爬升都从清单取）。
- 算法（所有来源共用）：按距离 100 m 重采样 → 5 点平滑 → 用相邻峰鞍部算相对高度
  找山顶（≥30 m、间距 ≥0.5 km）→ 以山顶为切点分段 → 原始高程 + 3 m 滞回算累计爬升。
- 赛事数值优先级：官方公布值 → manifest 参考值 → 轨迹计算值；三者都写进 `est`。
- 赛事打卡点在同一步产出：官方 `<wpt>` 投到**原始轨迹折线**上取里程与离轨距离
  （离轨距离必须对原始点算：重采样点是 100 m 一个，对它是"每个点都在轨外"），
  离轨 > 50 m 的标 `status: verify`。
- 每次跑都会写 `_meta.json`（算法版本 + 生成时间 + 各来源条数），这是"产物是哪一版"
  的唯一出口；产物本身不再各自背生成时间。

运行耗时：全量约 25 秒（157 条 / 约 150 万个原始轨迹点）。

## ② 底图：pipeline/build_terrain.py

```bash
python3 -m pip install --target /private/tmp/hikes-terrain-deps -r pipeline/requirements-terrain.txt
PYTHONPATH=/private/tmp/hikes-terrain-deps python3 pipeline/build_terrain.py
PYTHONPATH=/private/tmp/hikes-terrain-deps python3 pipeline/build_terrain.py --skip-existing
```

- 输入是 ①的产物（读 `coordinates` 与起点海拔），**不再自己解析 GPX**，
  所以底图与路书用的是同一条轨迹、同一把尺子。
- DEM 取 AWS Open Data「Terrain Tiles」的 terrarium 瓦片（z12 ≈ 30 m/px，
  与 SRTM GL1 30 m 同级），缓存在 `~/.cache/hikes/terrarium`（可用
  `HIKE_DEM_CACHE` 覆盖，CI / 沙箱里指向可写目录），出 760×420 晕渲 + 稀疏等高线 PNG。
  为什么不用 OpenTopography 的 SRTM GeoTIFF：同样精度下它每 1°×1° 要 15–25 MB，
  全量几百 MB；terrarium 单张几十 KB，慢链路上是几十分钟和几小时的区别。
  本地实测两者高程口径差中位 5–11 m。
- 等高线：起点基准取路线自己的起点海拔（`elevation_m[0]`），向下每 200 m 一条，
  向上按几何级数递进，到本条线路最高点收缩到 10 m。
- sidecar `<slug>.json` 写边界、`contour_origin_m`（含口径来源）、`dem_start_m`、
  `route_top_m`、`contour_steps_m`（API 读这个；`contour_interval_m` 是旧名，保留兼容）、
  `generatedAt`。
- 依赖只有 numpy / Pillow / scikit-image（不再需要 GDAL / rasterio），不进服务运行链路；
  首次跑要联网下瓦片。瓦片断线不会留半截文件（先写 `.part` 再改名）。

## ③ 入库

```bash
# 本地（容器里跑，路径用挂载后的 /srv）
docker compose -f server/docker-compose.yml exec -T api python /srv/seeds/seed_routes.py --all
docker compose -f server/docker-compose.yml exec -T api python /srv/seeds/seed_race_checkpoints.py

# 只导一份
docker compose -f server/docker-compose.yml exec -T api \
  python /srv/seeds/seed_routes.py --file /srv/routes-data/race_routes.json
```

- 一个脚本导三份产物，类型由产物里的 `kind`（`hike` / `race`）决定；
  过去是三个逐字重复的 upsert。
- **可重复执行、不清库**：按 slug upsert，只动自己这批。人工确认过的段难度
  （`route_segments.confirmed`）和峰名（`name_status = 'confirmed'`）不会被覆盖。
- **会清自己产生的残留**：切点或算法变了会让分段数变少，按 `(route_id, no)` upsert
  会留下旧行（2026-10-15 重导时清掉了 599 段 / 599 个山顶：库里另有 1570 - 971 段
  来自更早的切分规则）。清理范围只限 `source='auto' AND NOT confirmed` 的段、
  以及 `name_status <> 'confirmed'` 的山顶——人工结论留着待核，不跟着算法消失。
- `--demo-point` 只在导北京那批时创建 `QS-TEST01` 演示扫码点（首页"扫码打卡"、
  二维码与短链验收都用它，`docs/QR.md`、`docs/DEPLOY.md` 有引用，所以保留但默认不建）。
- 表结构变更走 alembic：分级语义与 `max_drop_m`、`level` 可空见
  `server/migrations/versions/0007_segment_difficulty_nullable.py`。

## 山头档案：100 座热门徒步登山山峰

```bash
docker compose -f server/docker-compose.yml exec -T api \
  python /srv/pipeline/import_china_peaks.py --dry        # 预演：只打印匹配结果
docker compose -f server/docker-compose.yml exec -T api \
  python /srv/pipeline/import_china_peaks.py             # 写入
docker compose -f server/docker-compose.yml exec -T api \
  python /srv/pipeline/import_china_peaks.py --with-points --with-opening   # 再补点位、板与开板留言
```

- 数据是 `pipeline/data/china_peaks_100.json`（2026-10-15 整理：名山大川 +
  大城市周边热门线路；坐标为 WGS84 山顶/主峰位置，人次与坐标来源逐行记录）。
  表结构见 `server/migrations/versions/0009_mountain_profile.py`（`mountains`
  新增 region / area_group / range_name / intro / heat_tier / annual_visits /
  summit_time / route_hint / provenance）。
- **档案与身份分开**：身份仍是「一行一座山、`stable_key` 唯一、合并只走人工链接」
  （`server/db/013`、`018`，`POST /api/admin/mountains/link`）。本脚本不按名字或
  距离自动合并：22 座已核实同山的写进脚本里的 `MERGES`，只更新那座山的档案、
  不覆盖海拔/几何/`name_status`；其余 78 座按 `cn-peak-100:<省>-<名>` 新建。
- **反例也写在脚本里**（`NOT_MERGED`）：四姑娘山的三座 5000 米级卫峰与库里
  「四姑娘山（幺妹峰）」是同一条山脊上的不同山顶；小五台山与五台山只是名字包含，
  相距 152 km。这些不合并，免得以后有人当成漏合并去"修"。
- **可重复执行**：本批自己的行按 `stable_key` upsert（改数据后再跑一遍就刷新档案），
  命中别人的同名同址山头则跳过并打印，不新建身份。
- **扫码点位、短链与山顶板**（`--with-points`）：沿用名山大川那批的格式，
  `points.code = CNP-<原表序号>`、`type = 'peak'`、`status = 'published'`、
  带 `country / province / city`，然后补 `short_links` 与 `boards('summit')`。
  已经有已发布点位的山头（22 座 CN-xx 与线路点位）直接复用，不另发编号——
  编号印在标牌上，一座山只能有一个；点位 `level` 按登顶用时与海拔分档
  （easy 5 / mid 35 / hard 38），不再一律写 `hard`。
- **开板留言**（`--with-opening`）：每块山顶板写一条资料留言（作者是资料账号
  「山野路簿」，内容取自本数据集的简介 / 常规路线 / 用时，≤ 200 字），
  空板不留空态。已存在则跳过，不重复写。
- 脚本末尾固定打印旧数据提醒（恒山、天柱山、青城山、武夷山四座的点位坐标与海拔
  对不上）：只报告不改，`--fix-coords` 才把差别 > 20 km 的旧几何纠正到真山顶。

## 难度语义（一处定义，三处一致）

规则只有一条，出现在三个地方，改一处必须同步另外两处：

1. `pipeline/build.py:segment_rating()`
2. `server/migrations/versions/0008_segment_continuous_climb.py`（0007 是它的上一版）
3. `server/app/main.py` 里 `/api/routes/{slug}` 的分段 SQL

```text
定级判据：净坡度 > 3% 或 段内最大连续爬升 ≥ 200 m（二者满足其一）
分级取两维度更高的那档：坡度 ≤15 / 15–25 / >25%，爬升 ≤200 / 200–500 / >500 m
净下坡段：level = null、difficulty_applicable = false、not_applicable = "descent"
其它未达判据的段：level = null、difficulty_applicable = false、not_applicable = "gentle"
整条没有可定级爬升的路线：routes.hardest_level = null（前端显示"未评级"）
```

爬升那一侧为什么用**最长连续爬升**（段内一次连续上升的最大幅度），而不是净高差或
累计爬升：

- 净高差会把起伏路算没。京西古道 9 km 净升 96 m，实际累计爬升 645 m，
  按净高差整条被判"未评级"；它的第 1 段最长连续爬升 301 m，本该是"中等"。
- 累计爬升又会把距离偷偷带进难度。同样是"起伏"，39 km 的赛段能累到 560 m；
  按累计值它会被判"困难"，但那只是路长。
- 最长连续爬升不受段长影响，并且和下降那一侧的 `max_drop_m` 对称：
  一段路里最长爬了多少、最长降了多少，两个数都写进产物与分段表。

为什么这样定：

- **下坡不用登顶难度表达**。下坡的风险是路面、湿滑、要不要保护，和"这段爬升多陡"
  不是一回事；过去下降段被塞了 `easy` 占位值，任何只认 `level` 的消费者都会读成
  "简单"。现在 `level` 为 `null`，界面显示灰标"不评级"，虚线画在坡度图与轨迹图上。
- **长缓坡 / 起伏路不因为净坡度小就不评级**。玉渡山第 1 段 12.28 km 净坡 3%、
  段内最长连续爬升 515 m，按爬升带定级为"困难"，不再是"不评级"。
- **段内最大连续下降** `max_drop_m` 记录在段上：切点只取山顶，没有峰的长下坡会被
  并进相邻段，这个值让它在分段表里仍然看得见。
  段内累计爬升/下降 `up_m` / `down_m` 也一并记录，供人核对。

指标（2026-10-15 重算）：北京 47 段中 25 段不评级、全国 164 段中 82 段、赛事 760 段中
379 段，合计 **971 段 / 486 段不评级（50%）**；合并前（净高差规则）是 965 段 / 710 段
不评级（74%），也就是说有 224 段本来是"白算"的起伏路，现在有了明确结论。
定级结果分布：简单 49 段、中等 327 段、困难 109 段。整条没有可定级爬升的路线
（上海佘山 `fff-100030572`、巴朗山 `fff-9177898`、罗浮山 `fff-100015705`、
武功山 13K `wugongshan-13k-2026`）为 `hardest_level = null`，界面显示"未评级"。

## 全量运行顺序（改算法后照这个跑）

```bash
python3 pipeline/build.py                                    # ① 重算路线与打卡点
PYTHONPATH=/private/tmp/hikes-terrain-deps python3 pipeline/build_terrain.py --skip-existing   # ② 补底图
# ③ 入库（容器在跑的时候）
docker compose -f server/docker-compose.yml exec -T api alembic upgrade head
docker compose -f server/docker-compose.yml exec -T api python /srv/seeds/seed_routes.py --all
docker compose -f server/docker-compose.yml exec -T api python /srv/seeds/seed_race_checkpoints.py
```

验收：

- `pipeline/out/_meta.json` 的 `generatedAt` 是本次时间，条数与 manifest 一致。
- `app/web/terrain` 的 png 数量 ≥ 产物里的路线数（157），且新产物的
  `generatedAt` 不早于 ①。
- `/api/routes/{slug}` 的 `segments[]` 里，下降段 `difficulty_applicable = false`、
  `level = null`、`not_applicable = "descent"`。
- 路书页下降段画成灰色虚线 + "不评级"，最难段卡片指向 `hardest.no` 那一段。

## 一次性 / 已退役脚本

| 脚本 | 状态 |
| --- | --- |
| `pipeline/build_routes_cn.py`、`build_races.py`、`build_checkpoints.py` | 已并入 `build.py`（2026-10-15 删除） |
| `server/seeds/seed_routes_cn.py`、`seed_race_routes.py` | 已并入 `seed_routes.py --file`（同日删除） |
| `server/seeds/seed.py` | 遗留：读 `app/js/route-sanfeng.js`（前端产物），已被 `seed_routes.py` 取代 |
| `tracks/build_app_data.py` | 一次性：给旧 SPA 生成 `app/js/routes.data.js` |
| `tracks/make_gpx.py`、`pipeline/bulu_2bulu.py` | 抓取工具（六只脚 / 两步路），不属于构建链 |
| `tracks/overview.py`、`pipeline/extract_design.py`、`pipeline/sync_design.py` | 素材与设计稿工具 |
| `server/seeds/seed_demo_*.py`、`backfill_*.py` | 演示数据与历史回填，已执行过 |

`tracks/parks/`（16 条公园跑道）目前不进这条链：没有入库、没有底图。要上架的话，
按 `cn` 的模式加第四个来源即可。
