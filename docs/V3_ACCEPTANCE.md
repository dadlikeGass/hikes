# V3 验收记录

依据：`docs/superpowers/plans/2026-10-15-hikes-v3-integration.md`（T1–T8、A01–A14）。

两条口径先说清楚：

- **本地自动化通过 ≠ 上线通过。** 真机定位、实际半径、现场补点这些只能在山上做，
  本文件里一律标「未验收」，不用本地结果冒充。
- 所有 drill 都跑在**隔离环境**（`hikes-v3test`：API 18000、DB 15432、独立数据卷），
  不碰开发库与生产库。跑法见 `server/tests/README.md`。

验收环境：macOS 桌面、Docker 29.8.2、Chromium 148（headless shell）、
PostgreSQL/PostGIS 16-3.4、Python 3.9（drill 侧）+ 3.12（容器内应用）。

## 一、Drill 结果（2026-10-16）

| 用例文件 | 覆盖 | 结果 | 证据 |
| --- | --- | --- | --- |
| `v3_schema_drill.py`（12） | 空库升级、旧库副本升级、约束、试点路线配置脚本 | 12 通过 | `docs/evidence/v3/T1_schema_drill.txt` |
| `v3_checkin_drill.py`（10） | 并发重试、409、业务日、合并、注销 | 10 通过 | `docs/evidence/v3/T2_checkin_drill.txt` |
| `v3_gps_drill.py`（7） | nearby、半径边界、精度、缺坐标、坐标不外泄 | 7 通过 | `docs/evidence/v3/T3_gps_drill.txt` |
| `v3_summary_drill.py`（9） | 凭证列表与游标、山级摘要去重、权限 | 9 通过 | `docs/evidence/v3/T6_summary_drill.txt` |
| `v3_efforts_drill.py`（10） | 配对顺序、资格、榜单门槛、并列、设置、故障隔离 | 10 通过 | `docs/evidence/v3/T5_efforts_drill.txt` |
| `v3_letters_drill.py`（10） | 三模式、封存不泄露、越权、删除 | 10 通过 | `docs/evidence/v3/T7_letters_drill.txt` |
| `v3_browser_drill.py`（8） | 断网入队/同步、拒定位、存储失败、SW 缓存边界、首页两档宽度、信件页面、到达页 | 8 通过 | `docs/evidence/v3/T4_browser_drill.txt`、`docs/evidence/v3/screens/` |

一次全量运行：`docs/evidence/v3/T1T7_drills_all.txt`（58 个用例）。

## 二、A01–A14 发布门槛

| 编号 | 操作 | 必须观察到 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- | --- |
| A01 | 游客扫码打卡后直接退出 | 无强制登录；真实 visit 存在 | **通过** | `v3_browser_drill.test_07` + `v3_checkin_drill`（游客 200 且库里一条） |
| A02 | 游客起点 GPS、山顶扫码 | 一条参考成绩，时间与两条记录一致 | 部分通过 | 服务端配对与用时一致已验（`v3_efforts_drill.test_01`）；游客成绩按计划只作参考、不进公开榜；现场 GPS 部分**未验收**（需真机，见 §三） |
| A03 | 终点先补传再传起点 | 最终只有一条成绩；离线成绩不自动上公开榜 | **通过** | `v3_efforts_drill.test_01`（配对与用时）、`test_05`（offline_submission 不进榜） |
| A04 | 同动作 20 次重试及双标签 | 一条到访，同一凭证 | **通过** | `v3_checkin_drill.test_01`（10 并发 ×20 次）、`test_02`；浏览器侧 `v3_browser_drill.test_01` 验多来源同步只入库一条 |
| A05 | 先游客打卡、账号已有同日记录、再合并 | 映射与成绩无悬空；重试不重复 | **通过** | `v3_checkin_drill.test_07`（dropped=1、回执重定向、重试回到同一 visitId） |
| A06 | 切换账号后同步队列 | 不串号，要求原身份恢复 | 部分通过 | 队列按身份隔离已验（`v3_browser_drill.test_01` 的 identity 断言 + `checkin.js` 单飞/改归逻辑）；**真机多账号切换未验收** |
| A07 | 拒定位权限 / 超距 / 低精度 | 可理解提示；无虚假成功记录 | **通过** | `v3_gps_drill.test_03/04/05/06`、`v3_browser_drill.test_02` |
| A08 | 同山两码 / 连续两日到访 | 一座山摘要，人数不按天增加 | **通过** | `v3_summary_drill.test_04/05` |
| A09 | 两路线、7/8 人、并列、关闭上榜 | 不混排，门槛正确，分母即时变化 | **通过** | `v3_efforts_drill.test_06/07/08`；`v3_schema_drill.test_07`（同山两入口各成一路线） |
| A10 | 三模式未来信 / 他人读取 | 正确解锁，封存不泄露，越权 404 | **通过** | `v3_letters_drill`（10 项） |
| A11 | 榜接口 500 / 摘要失败 | 打卡、留言及其他首页模块仍可用 | **通过** | `v3_efforts_drill.test_10`（用触发器注入配对故障：打卡 200、补偿作业后成绩自己出现）；首页模块独立失败态在 `v3_browser_drill.test_05` 与 `homeView` 逐块渲染 |
| A12 | 清缓存 / 存储满 / 首次无网 | 不声称可恢复不存在的数据，不假报保存 | **通过** | `v3_browser_drill.test_03`（禁 IndexedDB：提示"本机保存失败"） |
| A13 | 原扫码短链、留言、协作、注销 | 旧链路不回归；私人数据清理一致 | 部分通过 | `v3_schema_drill.test_08`（短链 302 到到达页）、`v3_checkin_drill.test_10`（注销清 visits/efforts/回执/信件）；原有 `server/tests/*_drill.sh` 回归**待跑**（见 §三） |
| A14 | 生产备份副本升级及恢复 | 数据完整；恢复步骤可重复 | 部分通过 | `v3_schema_drill.LegacyUpgradeDrill`：把发布前备份恢复进副本库再升到 head，点位/到访/用户/留言行内容校验和不变、旧到访时间回填 created_at；**生产库上的实际升级与恢复演练未做** |

## 三、未验收项（必须在现场/生产窗口完成）

| 项 | 为什么没做 | 怎么做 |
| --- | --- | --- |
| 真机 HTTPS 定位权限、实际半径校准 | 需要站在山上、用到真实设备与域名 | `server/tests/v3_browser_checklist.md` A、B 两节 |
| 试点路线两条（香山主上登 + 北门另一入口） | 起点点位坐标与所属山还没现场采集 | 采点后填 `server/seeds/v3_pilot_courses.json` 的 `lat`/`lng`，跑 `--apply --coordinates-verified` |
| 生产备份升级与恢复演练 | 需要生产窗口与授权 | 计划 T8 步骤：先扩表迁移，再上兼容代码；回退用备份，不做破坏性 downgrade |
| 原有 shell 回归（举报 / 限流 / 注销） | 需要在隔离环境逐个跑并核对 | `server/tests/*_drill.sh`（把 `DB_CONTAINER`/`API` 指向隔离项目即可） |

## 四、实现过程中发现并修掉的问题（drill 抓到的）

| 问题 | 影响 | 处理 |
| --- | --- | --- |
| 并发同 UUID 重试会在幂等唯一键上打成 500 | A04 不成立 | `checkins.record_visit` 先锁点位行、再查回执，重复回执用 `ON CONFLICT DO NOTHING` |
| 注销时先删 visits 会被 `segment_efforts` 外键挡住（500） | 注销失败，且私人数据残留 | 注销顺序改为先删成绩与本人回执，再删到访 |
| 补偿作业只插不重算 | 数据变更后成绩仍是旧结论 | `reconcile_efforts` 改为按 (course, 起终点) 冲突键 UPSERT 重算 |
| 作业脚本直接按路径执行导不到 `app` 包 | 生产定时任务一起步就 ModuleNotFoundError | 两个 job 入口显式把 `/srv` 加进 `sys.path` |
| 全是空格的正文被当成合法信件存下 | 用户拿到一封空信且封存后看不出来 | 写入前 `strip()` 再判空，返回 `LETTER_EMPTY` |
| 打卡动作的 `record` 变量作用域写错（ReferenceError） | 断网打卡直接报错、不入队 | 在外层声明变量；浏览器 drill 现在覆盖这条路径 |
| 自动同步与手动重试并发跑两轮 | 用户看到"还在等重试时间"而其实已经同步完 | `checkin.flush` 单飞，并把"本机还剩几条"一起返回给 UI |
| `letters` 列表不返回目标地点 | checkin 模式页面不知道在等哪个地点 | 回执增加 `pointCode`/`pointName`（不含任何坐标） |
