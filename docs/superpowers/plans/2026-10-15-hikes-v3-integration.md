# hikes V3 · 简化交互与现有后台接入实施计划

> 状态：T1–T7 已实施并有本地证据，T8 部分完成（真机与生产窗口待做）。依据本次会话确认的简化流程与页面布局；覆盖 PLAN_V2 中冲突的首页结构和主流程。历史方案保留，不代表已上线。
> 执行方式：逐任务实施、验证、记录证据；可使用 superpowers:executing-plans。每项验收通过后再标完成。

**Goal:** 在现有 `/app/` 上实现游客也可完成的扫码/GPS 打卡、离线同步与真实凭证，再接入次级排行榜和私人未来信。

**Architecture:** 保留当前原生 JavaScript SPA、FastAPI、PostgreSQL/PostGIS 与 Alembic。复用账号、游客身份、打卡、留言草稿和合并接口；新能力接真实数据库。新增小型职责模块，不全面重构 app.js/main.py。

**Tech Stack:** 原生 HTML/CSS/JS、IndexedDB、Service Worker、FastAPI、SQLAlchemy、PostGIS、Alembic、Docker Compose。

**Spec:** 本文第 1–5 节为本次规格；历史参考 `docs/PLAN_V2.md`、`docs/WEB_PRIORITIES.md`。本文中“实施默认”是为可执行性选定的技术/产品细节，不冒充用户逐条确认。

## 实施状态（2026-10-16 复核，证据见 `docs/V3_ACCEPTANCE.md`）

- **T1 完成**：迁移 0010–0013、隔离验收环境（`hikes-v3test`，API 18000 / DB 15432 / 独立卷）、
  `v3_schema_drill.py` 12 项全绿（含发布前备份副本升级：行内容校验和不变）；只读数据体检输出见
  `docs/evidence/v3/T1_data_audit_dev.txt`。
- **T2 完成**：`v3_checkin_drill.py` 10 项全绿（并发同 UUID 20 次一条、同日不同 UUID 一条、409、
  上海业务日与旧客户端兼容、合并前后同一 canonical 记录、注销清干净新增私人数据）。
- **T3 服务端完成 / 真机待验收**：`v3_gps_drill.py` 7 项全绿（nearby、半径 100/150 m 边界、精度 50 m、
  缺坐标、坐标不外泄）；真机 HTTPS 定位与现场半径校准按 `server/tests/v3_browser_checklist.md` 待做。
- **T4 客户端完成（本地） / 真机待验收**：`v3_browser_drill.py` 覆盖断网入队→联网只入库一条、
  拒绝定位、IndexedDB 不可用不假报保存、SW 不缓存私人响应；真机多标签、存储塞满、弱网按清单待做。
- **T5 完成**：`v3_efforts_drill.py` 10 项全绿（终点先到、跨天/超 12 小时、低于下限、离线补传、游客、
  未核实路线、弱证据、重算幂等、7/8 人门槛、并列、关闭上榜、注入故障后补偿作业补出成绩）。
- **T6 完成（本地）**：`v3_summary_drill.py` 9 项 + 首页两档宽度截图（`docs/evidence/v3/screens/`）。
- **T7 完成**：`v3_letters_drill.py` 10 项全绿（三模式约束、封存不泄露、越权 404、闰日、离线解锁、删除）。
- **T8 部分完成**：`docs/V3_ACCEPTANCE.md`（A01–A14 逐条状态）、API/DEPLOY/隐私与规则页面已更新；
  **生产备份升级与恢复演练、真机现场窗口仍是未验收项**，未用本地结果替代。

下面保留计划原文的勾选项，只把**已经有本地证据**的条目打勾；打勾不等于上线通过，
真机与生产窗口的条目一律留空。

## Global Constraints

- 唯一服务前端 `/app/`；不恢复 archive 中页面，不重做品牌视觉。
- 主流程：确认地点 → 我到了 → 成功凭证 → 可直接结束。
- 扫码与 GPS 汇入同一到达页；不强制注册、不自动发布留言。
- 榜单失败不得回滚已成功打卡；未同步记录不显示正式序号或排名。
- 首页无线路长列表、招募区、近期留言流、公开用时榜。
- 公开信不在本轮；私人未来信保留三种解锁方式。
- 私人响应不得进入公共缓存；任何客户端传来的身份、距离、排名均不能作为授权依据。
- 实施前读仓库适用指令，重新检查迁移头与工作区；不覆盖其他未提交修改。

## Review Focus

- 起终点逆序补传：最终生成同一条成绩，见 T3/T5。
- 游客注册后旧请求重试：不会丢记录、跨账号合并或重复发号，见 T2/T3。
- 无定位权限、低精度、首次无网打开：明确失败与恢复路径，见 T3/T4。
- 多二维码同山、重复到访、账号合并：人数与记录序号不混用，见 T2/T6。
- 退出账号或切换账号：队列、信件、上榜设置不串号，见 T4/T7。

## 1. 现有代码核对结果

| 能力 | 当前实际入口 | 本轮工作 |
| --- | --- | --- |
| 首页 | app/js/app.js: homeView；当前含主视觉、随机线路卡、功能格 | 收敛为打卡、摘要、最近凭证 |
| 线路与山头 | trailListView、trailDetailView、placesView | 保留线路；山头内接次级用时榜 |
| 到达与我页 | arrivalView、meView、meLettersView | 统一打卡结果；信箱接真实数据 |
| 网络层 | app/js/api.js，含游客身份、API 聚合加载 | 扩展请求方法，按页面加载，明确错误状态 |
| 游客打卡 | POST /api/guest/visit | 目前用 CURRENT_DATE；增加现场时间与证据校验 |
| 账号打卡 | POST /api/points/{point_id}/visit | 与游客共用服务层规则 |
| 合并 | POST /api/me/merge-guest；_merge_guest_records | 当前会删除同日同点重复游客行；需先迁移引用和幂等映射 |
| 历史到访 | GET /api/me/visits | 保留旧字段，新增独立凭证读接口 |
| 草稿/发布 | /api/me/arrival-drafts、游客 arrival-draft 与 publish | 沿用登录回跳、明确发布，不另造留言系统 |
| 地理实体 | mountains、trail_segments、points | 山级汇总按 mountain_id；路线身份不得仅用两点代替 |
| 未来信 | letters 基础表；meLettersView | 增加模式、授权与解锁接口 |
| 迁移与验证 | 当前文件头 0009_mountain_profile；server/tests/*_drill.sh | 新迁移重新确认编号；沿用脚本验收方式 |

注意：以上为源码静态核对，未查询运行数据库，不能据此声称现有部署已应用全部迁移。

## 2. 页面与用户行为规格

### 首页 #/home

自上而下：原主视觉 → 扫码打卡 / 附近打卡两个入口 → 到访摘要 → 最近一次凭证 → 原底部导航。

- 移除首页随机线路展示和重复扫码功能格；线路仍可由导航到达。
- 到访摘要最多 3 座山，显示山名、累计到访人数、我的最近到访；“查看全部”进入我的山峰记录。
- 首页不展示“我的第几个人”这一含混指标；序号在凭证详情解释为该点位入账记录序号。
- 最近凭证仅 1 张：地点、时间、用时（有才显示）、同步状态；点击进入凭证详情。
- 无记录显示“还没有到访记录”和打卡入口；游客摘要只展示本机身份关联记录，不伪造人数。
- 三块数据独立加载；某块失败显示重试，不让首页白屏。

### 山径 #/trails

保留现有筛选与线路卡。详情中复用已有点位数据跳转到达页；不在一级页面加榜、招募或信箱。尚未配置可打卡点位的线路显示真实空态，不用轨迹峰值自动充当起点。

### 占山为王 #/places

现有山头选择与认领/协作卡 → 当前山头用时榜次级模块 → 其余相关内容。必须先选择山头才显示该山路线榜；未选时显示选择提示。路线各自比较，默认本周，可选本月、本年、历史。前三名和我的最佳成绩；样本 <8 人不显示名次、百分位和有序前三，改显示本人用时与样本不足提示。

### 我 #/me

账号信息 → 山峰记录 → 历史纪念 → 想去 → 山间信箱入口 → 贡献/维护内容 → 设置。信箱入口只给状态摘要，写信表单在已有 #/me/letters 内。上榜开关放设置，不在打卡时打断用户。

### 到达页与凭证

扫码或附近点位选择 → 同一 #/arrive/:code → 地点名称、类型、信息 → 我到了。
成功页以“已到达 + 地点 + 时间 + 有效用时”为主；可选留一句话、查看山头、保存到账号。正式 seq 和排名在凭证详情，用户无需手动启动计时或配对。
未找到起点正常完成打卡，显示“本次未记录起点，暂无用时”。仅起点打卡显示已记录起点。

## 3. 数据与计算规则（实施默认）

### 3.1 到访与时间

- 首版保留现有同身份、同点、同日一条 visits；每天每条登顶路线最多一条成绩，删除旧方案“同日取最快一次”的承诺。窗口内跨天取个人最佳。
- UTC 存储，业务日期与周/月/年窗口统一 Asia/Shanghai；按现场时间计算 visit_date，周一为周起点。
- occurred_at 为客户端声明时间；recorded_at 为服务器时间。旧行两者回填 created_at，不将旧行自动认定为可信排名证据。
- 未来超过服务器 5 分钟的时间拒绝；超过 30 天的补传保留在本机并提示人工处理，不悄悄丢弃。两阈值可配置。
- 离线补传可保存纪念，但不直接取得公开排名资格；显示资格原因。首版仅实时接受且证据合格的起终点参加公开榜。
- seq 沿用点位入账记录序号，不冒称去重人数。已发序号不重排，合并产生空号允许保留。

### 3.2 身份、去重与合并

- client_uuid 是每次本机动作的随机 UUID；重试复用。独立 visit_submission_receipts 保存 UUID、原身份类型/ID、payload 摘要、canonical_visit_id。
- 幂等唯一键为 (identity_type, identity_id, client_uuid)，禁止 coalesce(user_id,guest_id) 混合编号空间。
- 同 UUID 不同 payload 返回 409；不同 UUID 同日同点返回既有 visit，并写回映射。
- 同一事务内完成 visit、seq 与幂等映射。合并先重定向映射与成绩引用，再移除重复行；保留原游客映射以支持同一账号的合法重试。
- 已合并游客 token 单独使用不可读取账号数据；须同时验证当前账号为合并目标。队列不能自动改归新登录的其他账号。

### 3.3 GPS 与点位

- 经纬度使用 points 中核实坐标；后台 PostGIS geography 距离校验，客户端距离仅供显示。
- 实施初值：山顶半径 100m、其他点位 150m、accuracy ≤50m；逐点可覆盖，真机校准后才能开放正式 GPS 打卡。
- 半径外、缺坐标、低精度拒绝 GPS 打卡，不生成成功凭证；扫码仍使用原独立入口。拒绝记录与访问日志不得包含精确坐标。
- 静态二维码和普通 GPS 都非强防作弊证据；榜单标为社区参考用时，不宣称竞技认证。
- nearby 请求体携带坐标，避免坐标进入 URL 访问日志；账号打卡精确坐标只供校验，30 天后清除原始坐标与精度，保留校验结果；删除任务须纳入部署。

### 3.4 成绩与人数

- 新增 ascent_courses：id、mountain_id、start_point_id、end_point_id、可空 trail_segment_id、路线名称、长度、爬升、min_duration_s、ranking_enabled。一条完整上登路线未必等于一个已有分段，必须人工配置并核实。
- 相同两点存在不同路径且不能区分时，ranking_enabled=false，仅留个人参考用时；不得直接混排。
- 任一端提交、补传、身份合并后都重试配对。现场起点早于终点、同业务日、间隔 ≤12h；无满足条件的配置路线不生成成绩。
- segment_efforts 保存 user_id 或 guest_id（二者恰一）、course_id、visit_date、两端 visit_id、时间、duration_s、eligibility、excluded_reason。身份/course/date 唯一，拒绝原因使用独立字段。
- 榜单仅账号、公开开关开启、路线启用、两端证据合格的成绩；每窗口每人最短一次，样本按人数。
- 位次=更快人数+1；同秒并列；前三按名次≤3取人，可能超过3人。百分位=更慢人数/有效人数×100，显示整数，说明同用时不算更慢。
- 窗口按终点 occurred_at；排行榜故障或配对失败不使打卡失败，成绩可显示计算中，修复任务可重算。
- 人数按 mountain_id 与合并后的身份去重；游客跨设备无法识别为同一真人，页面注明为记录身份去重。无 mountain_id 的点位不塞进山级汇总。

### 3.5 未来信

- 仅 self；date/checkin/open 三模式。date 提供 1/3/5 年，默认 5 年，闰日落到目标年二月末；open 保存即可读。
- checkin 必须指定点位，写信之后的新有效到访才解锁；该次到访 occurred_at > letter.created_at，离线记录服务器验证入账后生效。
- 所有读取在服务器判定权限及解锁，未解锁正文不下发；新增返回也不回显封存正文。checkin 显示目标地点与等待状态，不显示不存在的倒计时。
- unlock_at 改为可空 timestamptz：仅 date 必填；按模式增加 CHECK。旧日期按上海当天零点转换。
- 解锁状态在读取时计算，避免依赖定时任务才可打开；read_at 只记首次阅读。支持本人删除，注销时一并清除。

## 4. 接口契约清单（新接口是拟实施，非现有能力）

旧响应字段保持兼容；新字段统一沿用前端 camelCase。错误沿用现有错误结构和 code。

| 接口 | 请求 / 响应与权限 |
| --- | --- |
| 原两种 POST visit | 增 clientUuid、occurredAt、source、lat/lng/accuracyM、offline；旧客户端无新字段走服务端当前时间兼容。返回 visitId、seq、visitedAt、recordedAt、isFirstToday、effortStatus；原字段继续提供 |
| POST /api/points/nearby | {lat,lng,accuracyM}；公开限流；返回最多20个、2km内已启用点位的 code/name/kind/distanceM/checkinRadiusM；按距离排序；本接口不记录到访 |
| GET /api/me/visit-receipts | 账号；cursor/limit≤50；地点、seq、时间、用时、资格原因、是否本人记录 |
| GET /api/guest/visit-receipts | X-Guest-Token；相同形状；已合并身份要求账号授权 |
| GET /api/me/mountain-summary | 最近3山或分页；mountainId/name/visitorCount/myLastVisitedAt；无精确坐标 |
| GET /api/guest/mountain-summary | 同游客权限，只返回此身份到过的山 |
| GET /api/mountains/{id}/courses | 路线名称、起终点、是否启用排名；不泄露私人记录 |
| GET /api/efforts/leaderboard?courseId=&window=week | window=week/month/year/all；sampleSize、rankingAvailable、leaders、登录时 myBest。禁止公开完整精确时刻 |
| GET/PATCH /api/me/leaderboard-settings | {enabled:boolean}；关闭后即时退出榜与分母；默认开启但首次保存账号前展示公开范围说明 |
| GET/POST /api/me/letters | 列表：id/mode/place/status/unlockAt；仅已解锁返回正文。创建：text≤2000字符、mode、pointId或unlockAt，服务端校验模式 |
| GET/DELETE /api/me/letters/{id} | 本人；未解锁无正文，删除后不可访问；越权统一404 |

附近查询必须在泛化 /api/points/{code} 路由之前注册或使用独立 router，避免字符串路径吞掉 nearby。

## 5. 文件职责

修改：app/js/app.js（现有 view 与事件）、app/js/api.js（请求与页面加载）、app/index.html（脚本与 SW 注册）、现有 app/css 样式文件（实施前定位对应选择器）、server/app/main.py（保留路由壳、鉴权与合并接入）、server/app 的实际静态挂载配置、server/docker-compose.yml、deploy/nginx.conf、docs/API.md 等。
新增：app/js/checkin.js（定位/队列协调）、app/js/offline-store.js（IndexedDB）、app/sw.js（仅静态壳缓存）、server/app/checkins.py（校验/幂等/凭证）、server/app/efforts.py（配对/榜）、server/app/letters.py（解锁/权限）、server/jobs/purge_visit_coordinates.py、server/jobs/reconcile_efforts.py。模块参数传数据库连接与身份，不能反向 import main.py 造成循环。
新增：server/tests/v3_*_drill.py（unittest + httpx，独立测试库）；server/tests/v3_browser_checklist.md；docs/V3_ACCEPTANCE.md；新 Alembic revisions。不直接改历史 schema 脚本充当迁移。

## 6. 工作包与验收门槛

每个任务：先写对应有意义的失败用例 → 实现 → 跑目标用例 → 记录 API/数据库/浏览器证据 → 小范围提交。测试只连接隔离库；创建唯一前缀数据，失败也须清理；不要在生产注入样本。

### T1 契约、数据库与路线配置（1–2天）

依赖：无。文件：新 migrations、docs/API.md、server/tests/v3_schema_drill.py。

- [x] 确认 `alembic current/heads`，导出表约束与 points 坐标、山峰关联覆盖率；输出缺坐标/缺关联/多路径名单。
- [x] 先写迁移用例：旧记录时间回填正确、原二维码可查、身份唯一约束有效、信模式约束拒绝非法组合。
- [x] 顺序新增到访字段/幂等表、路线与成绩、信字段/上榜设置迁移；成绩依赖到访迁移，取消“全部独立回滚”表述。
- [ ] 建两个核实的试点：一条上登路线、同山另一入口；无法确认坐标的点位关闭 GPS/ranking。
- [x] 在空库和旧库副本升级，核对行数、外键及抽样字段；在隔离副本降到原 revision 再升回。注明降级会丢新增数据，生产优先回滚应用并保留扩展字段。

通过：迁移前后旧行为可用，所有新约束用例通过，有备份恢复记录；不是只比较行数。

### T2 统一在线打卡与身份合并（1–2天）

依赖 T1。文件 main.py/checkins.py、api.js、v3_checkin_drill.py。

- [x] 两个旧 POST 复用 `record_visit(conn, identity, point_id, payload)`，服务端输出统一凭证字段。
- [x] 实现身份隔离的幂等映射、事务发号、上海日期和历史回填兼容。
- [x] 修改 `_merge_guest_records`：映射/引用迁移、重复归并、同账号重试，禁止跨账号接管。
- [x] 修改注销流程清除新成绩、映射中的个人关联与信件；定义保留的匿名计数与既有注销口径一致。
- [x] 验证20个并发重复请求只落一条；不同账号相同数字ID不冲突；同UUID变payload返回409；周日现场周一补传归周日；合并前后旧重试返回同一canonical记录。

通过：旧扫码页面仍可打卡，现有草稿注册回跳与明确发布通过回归。

### T3 GPS 接入与统一到达页（1–2天）

依赖 T2。文件 checkins.py/main.py、checkin.js/api.js/app.js、v3_gps_drill.py。

- [x] 新增 nearby POST 和地理校验；精确坐标不写 URL、公开响应或错误日志。
- [x] 首页“附近打卡”按需请求定位；选择点位进入现有 arrivalView，保留 source 上下文且由服务端重新校验。
- [x] 成功页仅展示成功、地点、时间、可选用时及后续动作；移除强制注册或自动发布行为。
- [x] 试点验证半径内、边界、半径外、低精度、坐标缺失、权限拒绝、定位超时；拒绝不得产生 visits。
- [x] 补传和合并接入可重试配对调用点，失败不影响已提交到访。

通过：扫码、GPS 各跑游客与账号完整路径；使用 HTTPS 真机核实定位权限和实际距离，开发模拟不能替代实测。

### T4 离线队列与缓存（1–2天）

依赖 T2/T3。文件 offline-store.js/checkin.js/sw.js/index.html、静态服务挂载、v3_browser_checklist.md。

- [x] IndexedDB 保存动作UUID、创建身份、点位快照、现场时间/证据、pending/syncing/failed/synced、错误与重试次数。
- [x] SW 只缓存版本化静态壳；点位快照显式存库；不缓存 /api/me、token、信件及任何私人响应。
- [ ] 检查 /app/sw.js 的 MIME、路径和 /app/ scope；缓存更新等待安全激活，旧队列保留。
- [x] 页面打开、恢复联网、回到前台、手动重试均触发队列；不依赖浏览器后台同步支持。
- [ ] 401等待同身份登录、429遵守 Retry-After、5xx退避；4xx保留失败记录与原因，不无限重试。用户切换账号不得自动上传旧账号队列。
- [x] 起终点乱序、刷新、关闭重开、多标签重复同步、存储不足、退出登录分别验收；本机存储失败不得显示已保存。
- [x] 首次无网且未缓存明确提示不可用；已有页面/点位可离线记录。同期未获取游客token时先保留本机身份，联网领token后绑定上传。

通过：断网起点+山顶 → 重启 → 联网 → 两条到访准确入库；不重复发号；服务器拒绝记录仍可在本机看原因。

### T5 配对、排行与设置（1–2天）

依赖 T1–T4。文件 efforts.py/main.py、reconcile_efforts.py、api.js/app.js、v3_efforts_drill.py。

- [x] 实现 `reconcile_efforts(conn, identity, visit_date)`；任一端入账及合并后调用，按唯一键幂等写入。
- [x] 增加补偿作业：定时重扫近期新增/变更到访，重试失败配对；回填只产生参考成绩，不能升级历史证据资格。
- [x] 实现路线配置、异常用时原因、身份/窗口去重、并列排名、开关立即生效。
- [x] placesView 只对当前山头按需取数；设置中提供上榜开关；凭证详情读取真实成绩状态。
- [x] 验证终点先上传/起点后上传、跨日、超12h、低于路线下限、同人多日、两入口、并列、7人/8人阈值、退出分母、账号注销、游客合并。
- [x] 断开榜接口仍能打卡与留言；补偿作业后原凭证出现成绩，无需再次打卡。

通过：API、榜单、个人凭证用时一致；公开响应无精确坐标和时分；不可区分路径的路线不上榜。

### T6 首页及四个一级页收口（0.5–1天）

依赖 T2/T4/T5。文件 app.js/api.js/现有CSS、checkins.py、v3_summary_drill.py。

- [x] 实现凭证列表与山级摘要，游客户与账号权限分别验证；按 mountain_id 汇总去重。
- [x] homeView 按第2节调整：两个入口、≤3山摘要、1张凭证；移除旧首页大块入口/随机线路卡，相关能力由导航/详情可达。
- [x] 调整我页信箱预留位置及设置；山径保持原列表，点位详情接到达页；招募和路况留在所属页面。
- [ ] 拆分 api.js 首屏依赖，首页不等待所有线路、热榜、社区请求；模块空态与失败态独立。
- [ ] 390px/1440px 检查布局与返回路径；游客、无记录、有记录、待同步、API失败各留证据。

通过：首页无需滚过长列表即可看到主动作；同山两码只一条摘要；累计人数不会因重复到访增长；注册合并后立即刷新。

### T7 私人未来信（1–2天）

依赖 T1/T2/T3；可在主流程交付后实施。文件 letters.py/main.py/app.js/api.js、v3_letters_drill.py。

- [x] 实现创建、列表、读取、删除，所有路径先鉴权再按模式计算解锁；旧信日期转换检查。
- [x] meLettersView 接真实数据：封存状态、到期倒计时或目标地点、已解锁阅读、写信三模式；不给后来者选项。
- [x] 校验 date 输入、空/超长正文、无效地点；可删除封存信，不能通过修改模式绕过封存。
- [x] 检查未到期所有接口无正文、其他账号404、旧打卡不解锁、新打卡解锁、离线有效补传解锁、open即时可读、日期边界/闰年、注销清除。

通过：数据库真实保存，刷新重登仍存在；未解锁正文不出现在网络响应、页面缓存或错误日志中。

### T8 全链路验收与部署文档（1天＋真机现场窗口）

依赖 T1–T7。文件 docs/V3_ACCEPTANCE.md、API/PLAN/LAUNCH/WEB_PRIORITIES/DEPLOY、现有隐私页面、部署作业配置。

- [x] 更新公开范围、定位数据用途/30天清理、参考用时性质；落实定时清理和配对补偿，记录最后成功时间与失败日志。
- [x] 同步旧文档范围；给被替代条款加历史标记，保留旧内容。增加 extract_design.py 不得写回封存前端的保护。
- [ ] 在隔离环境运行全部 v3 验收与现有举报、限流、注销回归；确认附近 POST 纳入合适的限流桶。
- [ ] HTTPS、iOS/Android普通浏览器和微信内各跑扫码/定位、拒权、断网重开、注册回跳；实际山顶与起点校准半径。
- [ ] 备份生产数据，先扩展迁移后部署兼容代码，再启用试点 GPS 与路线榜；生产变更遵循实际部署授权。
- [ ] 应用回退时保留扩展表与离线队列；不用破坏性 downgrade 作为紧急回退。备份恢复演练单列证据。

通过：所有必需项有时间、环境、操作者和证据；真机/现场未完成就明确标未验收，不能用本地结果替代。

## 7. 可执行检查与验收记录

实施时新增的 drill 使用 Python unittest + 已有 httpx，不引入生产测试依赖。统一从仓库根执行：

```bash
# 当前环境只读检查
 docker compose -f server/docker-compose.yml exec api alembic current
 docker compose -f server/docker-compose.yml exec api alembic heads
# 仅隔离测试环境执行；V3_TEST_BASE_URL 指向该环境，脚本须拒绝非本机地址
 V3_TEST_BASE_URL=http://127.0.0.1:18000 python3 -m unittest discover -s server/tests -p 'v3_*_drill.py' -v
```

T1 须建立独立 Compose 测试项目/独立数据库卷、端口18000，生成可重复初始化命令写入 server/tests/README.md；测试不得复用默认 hikes 数据库。接口测试与数据库核对使用同一个隔离实例；运行迁移前打印目标库名并拒绝生产环境。现有 shell drill 按各自脚本要求在同一隔离环境执行，不假设参数通用。

`docs/V3_ACCEPTANCE.md` 每个用例记录：编号、前提身份、操作、预期HTTP/页面/数据库、实测结果、证据路径、日期、环境、遗留问题。最少覆盖下列发布门槛：

| 编号 | 操作 | 必须观察到 |
| --- | --- | --- |
| A01 | 游客扫码打卡后直接退出 | 无强制登录；真实visit存在 |
| A02 | 游客起点GPS、山顶扫码 | 一条参考成绩，时间与两条记录一致 |
| A03 | 终点先补传再传起点 | 最终只有一条成绩；离线成绩不自动上公开榜 |
| A04 | 同动作20次重试及双标签 | 一条到访，同一凭证 |
| A05 | 先游客打卡、账号已有同日记录、再合并 | 映射与成绩无悬空；重试不重复 |
| A06 | 切换账号后同步队列 | 不串号，要求原身份恢复 |
| A07 | 拒定位权限/超距/低精度 | 可理解提示；无虚假成功记录 |
| A08 | 同山两码/连续两日到访 | 一座山摘要，人数不按天增加 |
| A09 | 两路线、7/8人、并列、关闭上榜 | 不混排，门槛正确，分母即时变化 |
| A10 | 三模式未来信/他人读取 | 正确解锁，封存不泄露，越权404 |
| A11 | 榜接口500/摘要失败 | 打卡、留言及其他首页模块仍可用 |
| A12 | 浏览器清缓存/存储满/无缓存首次无网 | 不声称可恢复不存在的数据，不假报保存 |
| A13 | 原扫码短链、留言、协作、注销 | 旧链路不回归；新增私人数据清理一致 |
| A14 | 生产备份副本升级及恢复 | 数据完整；恢复步骤可重复 |

## 8. 交付顺序与估算

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8，单人约8.5–14工作日，另加现场设备验证时间；数据补点、路线核实不足会延长，不以此估算承诺上线日期。

里程碑一（T1–T4）：真实在线/离线打卡与游客合并可交付。
里程碑二（T5–T6）：四个一级页布局与榜单、凭证接通。
里程碑三（T7–T8）：私人未来信、全链路验收、部署准备完成。

完成定义：功能有真实写入/读取证据，失败可恢复，页面与后台一致，未验收项明确列出。页面截图、接口200或单纯新增字段均不足以证明完成。
