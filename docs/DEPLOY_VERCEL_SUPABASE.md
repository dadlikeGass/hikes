# Vercel + Supabase 部署

目标架构：

```text
浏览器
  └─ Vercel 自定义域名
      ├─ /app/*、/terrain/*、/assets/*  静态前端（Vercel CDN）
      └─ /api/*、/p/*、/media/*         FastAPI Function
                                              └─ Supabase Postgres/PostGIS
                                              └─ Supabase Storage（私有封面桶）
```

当前后端是 FastAPI，不是纯静态站。Vercel 会把根目录 `main.py` 作为
FastAPI entrypoint；Supabase 只承担数据库和对象存储。认证仍使用项目现有的
JWT，不需要启用 Supabase Auth。

## 0. 先准备本地

在仓库根目录确认：

```bash
python3 -c "import json; json.load(open('vercel.json')); print('vercel ok')"
ls main.py requirements.txt pyproject.toml
```

不要把 `.env`、Supabase service role key 或数据库密码提交到 Git。

## 1. 创建 Supabase 项目

1. 在 Supabase 创建项目，记下区域。尽量选离 Vercel Function 区域近的地方。
2. 打开 SQL Editor，启用 PostGIS 和 pg_trgm：

```sql
create extension if not exists postgis;
create extension if not exists pg_trgm;
```

3. 打开 **Connect**，分别复制：
   - **Session pooler**：端口 `5432`，只用于本地 Alembic 迁移。
   - **Transaction pooler**：端口 `6543`，用于 Vercel 运行时。

连接串需要把协议改成 SQLAlchemy 的 psycopg 格式：

```text
postgresql+psycopg://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:PORT/postgres
```

4. 在 Storage 创建 bucket：名称 `route-covers`，类型选 **Private**。
   服务端通过 service role 上传，公开请求只走 `/media/{key}` 的审核代理，
   待审图片不会直接暴露。

## 2. 迁移数据库

在仓库根目录执行。把下面连接串换成 **Session pooler（5432）** 的地址：

```bash
MIGRATE_DATABASE_URL='postgresql+psycopg://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:5432/postgres'

docker compose -f server/docker-compose.yml run --rm \
  -e DATABASE_URL="$MIGRATE_DATABASE_URL" \
  api alembic upgrade head
```

当前迁移链会创建申请表、成员/山寨、留言管理、封面投稿等结构，并回填历史身份。
完成后核对：

```bash
docker compose -f server/docker-compose.yml run --rm \
  -e DATABASE_URL="$MIGRATE_DATABASE_URL" \
  api python -c "from sqlalchemy import create_engine,text; import os; e=create_engine(os.environ['DATABASE_URL']); c=e.connect(); print(c.execute(text('select version_num from alembic_version')).scalar())"
```

### 导入线路和点位数据

如果要让线上的路书、地形和坡度图和本地一致，继续导入现有种子数据：

```bash
docker compose -f server/docker-compose.yml run --rm \
  -e DATABASE_URL="$MIGRATE_DATABASE_URL" \
  api python /srv/seeds/seed_routes.py --all

docker compose -f server/docker-compose.yml run --rm \
  -e DATABASE_URL="$MIGRATE_DATABASE_URL" \
  api python /srv/seeds/seed_race_checkpoints.py

docker compose -f server/docker-compose.yml run --rm \
  -e DATABASE_URL="$MIGRATE_DATABASE_URL" \
  api python /srv/seeds/backfill_peak_points.py
```

完成后检查 `/api/routes?limit=1`、`/api/points?limit=1` 和 `/health` 的数字，
不要只看迁移返回 0。

## 3. 在 Vercel 配置环境变量

把仓库导入 Vercel，Root Directory 保持仓库根目录。然后在
**Settings → Environment Variables** 添加 Production 和 Preview 变量：

| 变量 | 值 |
| --- | --- |
| `DATABASE_URL` | Supabase **Transaction pooler**，端口 `6543` |
| `JWT_SECRET` | 一条新的随机长字符串，例如 `openssl rand -hex 32` |
| `PUBLIC_BASE_URL` | 最终域名，例如 `https://www.example.com`，末尾不要 `/` |
| `SUPABASE_URL` | `https://PROJECT_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `ROUTE_COVER_BUCKET` | `route-covers` |

必须确认：

- `ALLOW_DEV_LOGIN` **不要设置**。
- `DATABASE_URL` 不要在 Vercel 使用直连的 IPv6 地址；用 transaction pooler。
- Vercel Function 区域尽量与 Supabase 区域一致。

## 4. 部署

使用 Git 导入时，Vercel 会自动识别根目录 `main.py`、`requirements.txt` 和
`pyproject.toml`。也可以本地执行：

```bash
npx vercel
npx vercel --prod
```

`vercel.json` 已把 FastAPI Function 设为最长 60 秒、1GB 内存。首次构建会安装
Python 依赖；如果失败，先看 Vercel 的 Build Logs，不要在本地反复重试掩盖依赖错误。

`tracks/` 是本地轨迹数据，不应进入 Function bundle；静态前端由 Vercel CDN
提供，`pyproject.toml` 中的 `exclude = true` 会把 `app/` 静态目录从 Function
包中移出。若仍出现 `LAMBDA_SIZE_EXCEEDED`，先排查新增大目录是否被
`.vercelignore` 排除。

## 5. 绑定域名

在 Vercel 项目 **Settings → Domains** 添加：

- `www.example.com` 作为主域名；
- `example.com` 作为重定向到 `www` 的域名。

Vercel 会显示需要的 DNS 记录。到域名注册商按它给出的值添加（通常 `www`
使用 CNAME，裸域使用 A/ALIAS；不要凭记忆填 Vercel IP）。等待证书变为
Active 后，把 `PUBLIC_BASE_URL` 改成主域名并重新部署。

## 6. 上线验收

```bash
curl -s https://www.example.com/health
curl -s 'https://www.example.com/api/routes?limit=1'
curl -sI https://www.example.com/app/ | head -1
curl -sI https://www.example.com/terrain/sanfeng.png | head -1
```

浏览器再检查：

1. `/app/` 首页、路书列表、`三峰连穿` 详情页的地形图和坡度图；
2. 注册/登录、打卡、留言、申请草稿；
3. 全国站点搜索结果覆盖数据库，而不是只覆盖演示数据；
4. 封面投稿上传后，待审地址不能直接访问，审核通过后 `/media/{key}` 可访问；
5. 手机和桌面都能打开，刷新后不会回到旧缓存。

## 7. 已知限制

- Vercel Function 是无状态短生命周期进程，不运行 `server/jobs/`。每日清理和成绩补偿需要另外接 Vercel Cron、Supabase Cron 或独立的 worker。
- Vercel 本地文件系统不可作为持久化存储；封面必须走 Supabase Storage。未配置 Supabase Storage 时，本地开发仍回退到 `server/media/`。
- 数据库连接使用 transaction pooler 时不能依赖 prepared statements 或 session 级 advisory lock；当前引擎已关闭 prepared statements，事务级锁仍在事务内使用。
- `xigu` 只是 `app/js/data.js` 里的本地演示线路，不在数据库；上线后请用 `/api/routes` 返回的真实 slug，或先把演示线路导入数据库。
