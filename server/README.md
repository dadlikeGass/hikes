# server · 到此一游后端

## 一条命令起全栈

```bash
cd server
docker compose up --build
```

- API：http://localhost:8000 · 接口文档 http://localhost:8000/docs
- Postgres + PostGIS：localhost:5432（hikes / hikes / hikes）
- `db/001_schema.sql` 会在首次启动时自动执行，建表 + 装 PostGIS

## 导入种子数据（三峰连穿）

```bash
docker compose exec api python /srv/seeds/seed.py
```

数据来自 `app/js/route-sanfeng.js`——那是 pipeline 已经算好的分级结果
（真实 GPX，100 m 重采样 → 平滑 → 找山顶 → 分段定级）。
等 `pipeline/` 工程化之后，这个脚本改成直接调 pipeline，不再读前端产物。

## 怎么验证（W1 验收）

```bash
curl -s localhost:8000/health
```

应该看到 `postgis` 版本、以及 `segments: 6` `peaks: 5` `routes: 1` `points: 1`。

```bash
curl -s localhost:8000/api/routes/sanfeng | head -c 400
```

应该看到 6 段（每段带 `level` / `pct` / `kind` / `source: auto` / `confirmed: false`）
和 5 个山顶（带 `altitude` 和 `rise`）。

```bash
curl -s localhost:8000/api/points/QS-P1092
```

应该看到点位详情 + `visitCount`。

```bash
curl -s -X POST localhost:8000/api/points/1/visit \
  -H 'Content-Type: application/json' -H 'X-User-Id: 1' -d '{"source":"scan"}'
```

第一次返回 `seq: 1`，**再执行一次返回同样的 seq 且 `isFirstVisit: false`**——
这就是"一天一次"去重生效的证明。

## 现在还没做的（W2 补）

- 微信登录 + JWT（现在是 `X-User-Id` 头，只为联调）
- 短链路由 `GET /p/{code}`（表已经建好）
- 留言接口 + 赞/踩（表已经建好）
- 埋点接口 `POST /api/events`
- 迁移改用 alembic（现在是启动时执行 SQL，只适合初始化）
