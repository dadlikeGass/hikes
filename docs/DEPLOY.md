# 上线部署

## 一、服务器准备

香港/新加坡节点（免备案）。最低 2 核 4G、40G 盘。

```bash
# 装 docker（Ubuntu/Debian）
curl -fsSL https://get.docker.com | sh
```

## 二、跑起来

```bash
git clone <仓库> && cd hikes/deploy
cp .env.example .env && vi .env      # 至少改 POSTGRES_PASSWORD / JWT_SECRET / PUBLIC_BASE_URL
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api alembic upgrade head   # 建表/升级，空库也走这条
```

**建表和升级统一走 alembic**（2026-10-14 起）。Docker 启动不再自动执行 SQL，`docker compose up` 之后必须跑一次 `alembic upgrade head`，否则表不存在；不能把“重启 Compose”当作迁移。生产 API 挂载当前 `/app/` 页面，不使用旧静态原型替代。`021_board_collaboration.sql` 增加按板协作申请及独立审核角色；`022_maintenance_audit.sql` 增加维护操作审计；`023_comment_appeals.sql` 增加留言申诉。运营账号需由数据库管理员明确授予对应审核角色，不能由维护人或注册流程自动授予。

### 迁移台账与升级（2026-10-14 起）

```bash
cd deploy
docker compose -f docker-compose.prod.yml exec api alembic current      # 现在到哪一版
docker compose -f docker-compose.prod.yml exec api alembic history      # 版本序列
docker compose -f docker-compose.prod.yml exec api alembic upgrade head # 升到最新
docker compose -f docker-compose.prod.yml exec db \
  psql -U hikes -d hikes -c "SELECT version, action, applied_by, applied_at FROM migration_log ORDER BY id DESC LIMIT 10"
```

- 台账是两张表：`alembic_version`（当前版本）和 `migration_log`（每次升级的版本、动作、执行者、时间）。
- 空库：`upgrade head` 按顺序执行 `server/db/001`–`023`（基线修订 `0001_baseline`）。
- 已有库：逐个文件检查哨兵对象，**缺哪个补哪个**。停在 018 的旧库也只补 019–023，不重复建表、不删数据、不动留言与到访记录。
- 失败：任何修订抛错即整版回滚，`alembic_version` 不前进，退出码非 0。看到非 0 就是没升上去，不要继续后面的步骤，先查日志。
- 库被手工改坏（哨兵对象缺失但版本已登记）会在升级时报错并列出缺失的迁移，先人工核对再继续。
- 数据库迁移脚本已冻结为历史记录：以后所有表结构变更都在 `server/migrations/versions/` 新增修订，不要往 `server/db/` 加 SQL 文件。规则见 `server/migrations/README.md`。
- **回滚不靠 downgrade**：回退方式是用第 6 节的备份把库恢复到发布前的状态，再把应用退回上一个 git tag。`0001_baseline` 的 `downgrade()` 直接报错，防止有人用它删表。

## 三、导入线路数据

```bash
# 本地先跑分级，产物入库前需要存在
python3 ../pipeline/build.py

docker compose -f docker-compose.prod.yml exec api \
  python /srv/seeds/seed_routes.py

# 生成线路山顶二维码点位；首次导入线路后执行
docker compose -f docker-compose.prod.yml exec api \
  python /srv/seeds/backfill_peak_points.py
```

## 四、验证

```bash
curl -s https://你的域名/health
# 期望：{"ok":true,"postgis":"3.4 ...","routes":12,"segments":75,...}

curl -sI https://你的域名/p/QS-TEST01 | head -1
# 期望：302；示例点位需先确认已导入

curl -s https://你的域名/api/qr/QS-TEST01/target
# 期望：encodes 指向你的正式域名，不是 localhost
```

**最后一步必须做**：用手机扫一次真实二维码，确认能跳到落地页并能打卡。

## 五、上线检查表

| # | 检查项 | 怎么确认 |
| --- | --- | --- |
| 1 | `.env` 不在版本库里 | `git ls-files \| grep -c '^deploy/.env$'` 应为 0 |
| 2 | `JWT_SECRET` 是随机串，不是示例值 | `grep JWT_SECRET .env` |
| 3 | `ALLOW_DEV_LOGIN` 没有设置 | `grep ALLOW_DEV_LOGIN .env` 应无结果 |
| 4 | 数据库端口没有对外暴露 | `docker compose ps` 里 db 没有端口映射 |
| 5 | `PUBLIC_BASE_URL` 是正式域名 | `curl /api/qr/{code}/target` |
| 6 | 二维码编码的是正式域名 | 同上，不能出现 localhost |
| 7 | 备份容器在跑，且当天有 dump | `ls deploy/backups/` |
| 8 | **真的恢复过一次** | 见第六节 |
| 9 | 手机扫码能打开落地页 | 拿手机扫 |
| 10 | 打卡后刷新数据还在 | 打卡 → 刷新 → 记录仍在 |

## 六、恢复演练（必须真做一次）

没恢复过的备份等于没有备份。2026-10-13 已在本地 Docker 对当前开发库演练 `pg_dump -Fc` → 临时库 `pg_restore --exit-on-error`，`routes/points/boards/visits/comments` 行数一致；2026-10-14 复演一次并补齐证据：dump 797,075 字节（1 秒）、`pg_restore --exit-on-error` 恢复 2 秒无报错，`routes=157 / points=1642 / boards=3054 / mountains=1484 / trail_segments=1570 / visits=156 / comments=5 / users=25` 与源库逐项相等；再把 `DATABASE_URL` 指向恢复库启了一次应用读取（`/health` 200，路线列表与线路详情正常）。演练库当场删除，开发库未受影响。

这两次都是**本地**演练，**不等于生产环境演练通过**；生产窗口内仍要按下面步骤真做一次。

```bash
# 新的空库
docker compose -f docker-compose.prod.yml exec db \
  psql -U hikes -c "CREATE DATABASE hikes_restore;"

# 从最近的 dump 恢复
ls deploy/backups/                       # 挑一个
docker compose -f docker-compose.prod.yml exec backup \
  pg_restore -h db -U hikes -d hikes_restore /backups/<文件>.dump

# 核对行数
docker compose -f docker-compose.prod.yml exec db \
  psql -U hikes -d hikes_restore -c "SELECT count(*) FROM routes;"

# 核对完删掉
docker compose -f docker-compose.prod.yml exec db \
  psql -U hikes -c "DROP DATABASE hikes_restore;"
```

## 七、已知的未完成项

- **正式账号**：用户名密码注册/登录已实现；微信登录不在当前 H5 上线范围。生产必须关闭 `/api/auth/dev-login`。邮箱验证与找回密码仍未完成。
- **无内容审核**：留言是明文入库的，UGC 合规要求先过机审。正式对外开放前必须补。
- **HTTPS 未配**：nginx 里 443 那段是注释，证书就绪后启用。
- **限流**：注册/登录、新建游客身份、留言/情报、打卡、举报均已按身份＋IP 双桶限流（阈值与环境变量见 `docs/API.md`「写接口限流」），本地已有可重复验收脚本 `server/tests/rate_limit_drill.sh`；**公开读取限流、批量抓取识别与压测尚未做**，反爬不能算验收通过。
- **迁移台账**：2026-10-14 起改用 alembic（`alembic_version` + `migration_log`），本地已验证空库、已有库、半升级库和失败回滚四条路径；生产环境首次执行 `alembic upgrade head` 才算验收通过。
- **api 镜像是否装了 alembic 还没验**：本地 Docker Hub 抽风、镜像没重建成功，当前开发容器里的 alembic 是临时 `pip install` 进去的。下次能拉镜像时跑一次 `docker compose build api && docker compose exec api alembic current` 确认。
