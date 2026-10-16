# 轨迹分析管线评估

> **2026-10-15 合并结果见 [PIPELINES.md](./PIPELINES.md)**：`build_routes_cn.py`
> `build_races.py` `build_checkpoints.py` 已并入 `pipeline/build.py`（唯一入口，
> `--source beijing|cn|races`），`seed_routes*.py` 三份合并为一个 `--file` 脚本。
> 下面各条的现状：**第 1、2、7 条已落实**（鞍部相对高度；下坡段 `level` 为 null、
> 界面显示"不评级"、另记 `max_drop_m`；幂等导入且不覆盖人工确认字段）；
> **第 4 条部分落实**（`algorithmVersion` 升到 3，`_meta.json` 记版本与生成时间，
> 但还没写每条轨迹的原始 hash 与阈值参数）；**第 5 条已落实**（赛事不输出休闲
> 估时与热量）；**第 3、6 条未动**（候选片段与稳定路段身份的匹配、峰名候选审核）。

> 2026-10-13 代码审查。当前建议：保留“单一 GPX 核心算法 + 多来源 manifest 适配”的结构；在关键算法和峰名匹配修正前，产物只能作候选数据，不能直接当成用户可见的正式山峰/难度/用时。

## 已有能力

- `pipeline/build.py` 解析 GPX、按距离重采样、平滑高程、计算累计爬升/下降、轨迹几何、剖面、候选山顶和分段。
- `build_routes_cn.py` 与 `build_races.py` 复用核心处理，并从 manifest 读名称、地区、赛事元信息；方向正确，减少多份算法漂移。
- `build_checkpoints.py` 将赛事 GPX 的官方 waypoint 投影到轨迹，单独作为赛事检查点，避免误作社区扫码点位；职责边界合理。
- 峰名匹配脚本提供 Wikidata、维基地理搜索、OSM 等候选来源，且至少两份脚本默认只报告、`--apply` 才写入，具备人工审阅入口。

## 必须调整

1. **相对高度计算已修第一版**：`build.py` 现在从当前峰两侧相邻峰之间的鞍部计算 prominence，不再取两峰之间任意最低点；线路端点峰因缺一侧鞍部不自动入候选。仍需在阶段 1 后以人工标注轨迹核对峰数和位置。
2. **下降段难度已修第一版**：`build.py` 不再用绝对高差/坡度将下坡标为登顶难度；纯下降段暂标 easy 作为兼容值，后续模型应将 difficulty nullable，并用独立下坡路况字段表达风险。需要迁移时更新旧 UI 语义。
3. **分段不可复用**：`route_segments` 是每条完整路线的算法切片，不等于稳定路段板。需要将候选片段匹配到独立的有方向 route_segment 身份；同一路段被多份路线引用时复用身份，算法片段版本变化不能新建留言板。
4. **算法结果未版本化/溯源不够**：每个输出需带 `algorithm_version`、原始轨迹 hash、处理时间、采样/平滑/阈值参数、数值来源与人工确认状态。重新跑管线必须可比较差异，不能静默覆盖已确认数据。
5. **步行估算不适用赛事**：赛事入口沿用徒步 `hours/kcal` 参数（`basis: hike`）；对越野赛事展示会误导。比赛官方关门/赛道时间与休闲参考用时分开；在验证活动专属估算法前，赛事不输出休闲平均用时和卡路里，或明确只显示赛事官方数据及其来源。
6. **名峰匹配须人工确认**：已新增 `route_peak_candidates`，`match_peaks_web.py` 与 `match_peaks_osm.py --apply` 写候选证据，不覆盖正式名称。仍需审核 API/UI 后再绑定 `mountain_id`。
7. **导入必须可重复且不破坏用户数据**：北京、区域、赛事 seed 已去除 TRUNCATE/删行重建，按稳定路线和算法序号 upsert，并保留人工确认难度、峰名及线路峰 ID；CP 表独立重导入逻辑待后续审查。

## 逐脚本建议

| 脚本 | 结论 | 处置 |
| --- | --- | --- |
| `build.py` | 核心复用合理，算法需修 | 优先修 prominence、上下坡分级、海拔缺失值处理、输出版本元数据；保留 JSON 中间产物 |
| `build_routes_cn.py` | 适配职责清晰 | 继续复用核心；检查 manifest 来源/许可/更新时间并写入产物 |
| `build_races.py` | 元数据与官方距离/爬升回退合理 | 去掉徒步估时/热量作为赛事事实；赛事年份属于 route identity，不属于山峰 identity |
| `build_checkpoints.py` | 官方赛点单独建模合理 | 增加可配置贴轨距离阈值；远点标为待核验，不只打印警告 |
| `match_peaks.py` | Wikidata 可作候选，覆盖有限 | 只输出候选；禁用对 routes.json 的自动名称写入作为发布数据 |
| `match_peaks_web.py` | 地理搜索候选有帮助 | 保留报告模式；`--apply` 改为写候选/审阅状态，不能直接改正式峰名 |
| `match_peaks_osm.py` | OSM 区域与距离过滤有帮助 | 同上；固定地点清单与 viewbox 需要按数据区域配置 |
| `import_peaks_search.py` / `import_famous_peaks.py` | 外部搜索手工导入，适合一次性资料补全 | 不能把来源文本抓取结果直接发布；收敛到一个受审阅导入格式，并记录来源/许可/确认者 |

## 推荐处理链

```text
原始 GPX + 来源 manifest
  → 结构化解析与轨迹质量检查
  → 统一核心算法，产出带版本的路线/候选峰/候选片段
  → 外部地名匹配仅生成候选及证据
  → 人工确认山峰身份与有方向的稳定路段身份
  → 生成可审阅差异
  → 幂等导入：routes / route_segments / route_peaks / checkpoints
  → 发布后页面、二维码与留言板引用稳定实体 ID
```

## 验收规则

- 对包含明显双峰与鞍部的已知 GPX，峰数、位置和 prominence 对照人工标注；端点不凭空生峰。
- 纯上坡、纯下坡、往返/环线的分段方向与难度符合定义；下坡不成为登顶难度。
- 同一物理山峰出现在两条路线时匹配到同一 mountain ID；未确认候选不能覆盖正式名称。
- 重跑同一输入不新增重复实体、不删除留言/打卡、不覆盖人工确认字段。
- 官方赛事距离/爬升的来源可追溯；轨迹计算值同时保留供差异核验。
- waypoint 离轨超过阈值时入待核验，不显示成确定路线数据。
# Real DEM terrain assets

Route geometry keeps its resampled latitude/longitude values in the generated
route JSON and in `routes.geom`. To build a terrain layer for the published
Beijing hike routes, install the optional raster dependencies and run:

```sh
python3 -m pip install -r pipeline/requirements-terrain.txt
python3 pipeline/build.py
python3 pipeline/build_terrain.py
```

`build_terrain.py` downloads the needed public OpenTopography SRTM GL1 30 m
tiles into the user cache, then writes `app/web/terrain/<slug>.png` and a small
geographic bounds file. It creates hillshade and DEM-derived contours anchored
to the route start elevation: intervals transition continuously from 200 m at
the start to 10 m at the route's highest DEM-sampled point; below the start,
contours remain 200 m apart. For another manifest route, pass its slug with
`--slugs`. Rebuild/import route JSON with the matching `seed_routes*.py` script
so the API serves its real geometry and the map layer together.
