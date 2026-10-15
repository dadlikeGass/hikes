# 阶段 0：实现基线核对

> 2026-10-13 文件/路由/契约核对。该清单记录代码事实，不把存在文件等同于功能通过。

> 后续实施更新：本页下表保留阶段 0 的历史盘点，不代表当前实现。迁移 013、017、018 已在本地数据库执行；山顶扫码点位已有 `mountain_id`，同山多入口共板、人工审核合并及审计已接入 API 和原 `/app/` 页面。当前进度与未完成验收以 [PLAN.md](PLAN.md) 为准。

## 页面、入口与数据

| 页面/能力 | 文档目标 | 当前实现 | 差异/状态 |
| --- | --- | --- | --- |
| 首页 | 扫码 → 完整线路 → 山顶/岔路/路段近期内容 → 招募 | `app/web/home.html` 调 `/api/routes`，近期留言固定读 `/api/points/1/comments` | 只接一块固定点位板，未聚合三类留言；维护招募态未核实 |
| 山顶扫码 | 识别地点、游客到访凭证、可选留存/留言、注册回跳 | `server/app/main.py` 有 `/p/{code}`、guest visit、guest merge；`app/web/pages/arrive.html` 是静态视觉稿 | 静态页未接数据；游客合并只迁移 visits，无留言草稿接口；幂等键未实现 |
| 山头页 | 独立山峰、到访、各入口路段、共享山顶板、维护人 | 有 `/api/points/{code}` 和旧 `route_peaks` 聚合；`peak.html` 静态 | 无独立 mountain ID，跨路线共享板未实现 |
| 岔路/路段 | 来向去向/方向，稳定共享板 | 有 points junction 及 `/api/segments/{sid}/comments`，segment 指路线算法行 | 无跨路线稳定段身份；静态页面未接接口 |
| 路书 | 全线路基础数据，段难度分开 | routes/route_segments/route_peaks API 与页面存在 | route_segments 是算法切片，非稳定可复用路段；赛事 detail 仍可能显示徒步估值 |
| 我 | 山峰关系、纪念、想去、贡献、维护板 | 有 visits/wants/tracks/king API | 字段和当前排序未按新定义核对接通 |
| 广告/维护台 | 每板一槽、维护人提交、系统审核/提升 | summit_ads 表及对应 API 存在 | 旧按维护等级配额仍在；审核/提升只要求有效用户 JWT，未做运营 capability 校验 |

## 后端与存储

- API：FastAPI 单体 `server/app/main.py`；数据库 Postgres/PostGIS；静态 HTML 由同一 API 服务托管。
- SQL：`server/db/001_schema.sql` 是新库 schema；002–012 是按文件名在 Postgres 首次初始化时执行的增量 SQL。已有持久卷不会自动执行新增脚本；无 alembic/迁移登记与升级 runner。**（2026-10-14 已解决：建表与升级改走 alembic，台账为 `alembic_version` + `migration_log`，`db/001`–`023` 冻结为基线修订 `0001_baseline` 的历史脚本，Docker 启动不再自动执行 SQL；见 `server/migrations/README.md` 与 `docs/DEPLOY.md`。本行其余内容保留为阶段 0 的历史记录。）**
- 身份：users、guests、points、routes、route_segments、route_peaks、claims、short_links；暂缺 mountains、稳定 trail_segments 及 board 表/身份键。
- 关键接口清单：公开 `GET /api/routes`, `/api/routes/{slug}`, `/api/points`, `/api/peaks`, `/api/points/{code}`, `/api/points/{point_id}/comments`, `/api/segments/{sid}/comments`；扫码 `/p/{code}`, `/api/guest`, `/api/guest/visit`, `/api/me/merge-guest`；写入含 dev-login、visit、comments、claims、ads、admin ads。
- 安全：compose 显式 `ALLOW_DEV_LOGIN=1`；JWT 默认 secret 有开发值；CORS `*`；审核/提升缺角色授权。不能公开部署。
- 导入：`seed_routes.py` 原先 TRUNCATE 包含 visits/comments/points/routes；区域与赛事 seed 按路线 upsert，但删重建 route_segments/route_peaks 会丢下游关联/人工字段；checkpoint 重导入删重建行。
- 部署：`docs/DEPLOY.md` 提及 `deploy/docker-compose.prod.yml` 和备份服务，但本次文件清单中未找到 `deploy/`，实际生产资源状态未知。

## 文档冲突/待补齐

1. PLAN §3 逻辑路由 `/trails`、`/peaks/:id` 与无构建 H5 的实际 `.html` 路径不同。
2. PLAN 旧招募卡首屏、静态到达页旧模块与 WEB_PRIORITIES 当前顺序冲突；按原则保留设计外观，仅调整数据及模块显示逻辑，视觉冲突由用户确认前不擅自重做。
3. API 文档旧对象/字段示例仍覆盖单路线峰；当前新增 DB 模型仅定义身份基础，完整新 API 契约需在业务闭环阶段前补齐。
4. PLAN 数据表说明与现行 001_schema.sql 存在版本漂移；须以新迁移及本文件标明代码实际状态。
5. 反爬策略和 AI agent 友好接口/页面说明尚未定义威胁模型与边界。

## 阶段 0 完成条件与结果

- 页面/接口/表与关键差异列明：**完成（文件级核查）**。
- 生产数据/真实部署/所有页面视觉逐项人工验收：**未完成，无法从仓库静态文件证明**。
- 冻结页面设计与旧稿对应关系：**存在未决冲突；不得自行改版**。
- 代码本身已运行验证：**仅限后续明确执行的语法/迁移检查；本盘点不是线上验收**。

## 阶段 1 数据地基变更记录

- `server/db/013_stable_trail_entities.sql` 新增 `mountains`、`trail_segments`、`route_segment_links`、`boards`、`route_peak_candidates`，并兼容回填旧峰/旧路线片段。
- 旧峰按 `(route_id, idx)` 建立各自待确认实体，不按距离或名称自动合并；旧路线算法片段按路线范围建候选身份，不假装已跨路线复用。
- 北京、区域和赛事 seed 已改为按路线 slug upsert；不再 TRUNCATE 访问、留言、点位；不再删重建峰段，已确认难度、峰名、山顶板和赛事 CP 标注保留。
- 候选峰匹配脚本 `--apply` 改写待审候选表，不再直接覆盖正式峰名。
- **部署注意**：Postgres entrypoint SQL 只对空数据卷生效；现有数据库必须在备份后显式执行 `psql -v ON_ERROR_STOP=1 -f server/db/013_stable_trail_entities.sql`。新模型目前尚未切换现有 API，H5 仍兼容旧表。当前迁移不做跨线路实体自动归并，需后续审核工作流。
