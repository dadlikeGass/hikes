# 数据库迁移

台账 = 数据库里的 `alembic_version`（当前版本）+ `migration_log`（每次升级的时间与说明）。

## 常用命令

```bash
cd server && docker compose exec api alembic current      # 现在到哪一版
cd server && docker compose exec api alembic history      # 版本序列
cd server && docker compose exec api alembic upgrade head # 升到最新（空库也走这条）
```

## 规则

1. **`server/db/*.sql` 已冻结**，是 001–023 的历史记录，只被 `0001_baseline` 读取用来重建空库。以后不要往 `db/` 里加 SQL 文件。
2. 任何表结构变更都在 `migrations/versions/` 新增一个修订，`upgrade()` 里写 DDL（可以直接 `op.execute(...)` 写 SQL），文件顶部用中文写清改了什么、为什么、怎么验收。
3. 修订必须能回答"失败会怎样"：Postgres 上每个修订自带事务，抛异常即整版回滚，`alembic_version` 不会前进，退出码非 0。
4. **回退不靠 downgrade**：回退方式是按 `docs/DEPLOY.md` 用备份恢复到发布前的库。`0001_baseline` 的 `downgrade()` 故意直接报错，防止有人用它删表。

## 为什么把 SQL 文件收进 alembic

2026-10-14 之前，表结构靠手工按文件名顺序执行 `db/001–023`，没有任何版本登记，无法回答"生产环境现在跑到哪一版"。现在空库和已有库都只走 `alembic upgrade head`：已有库按文件哨兵逐项检查，缺哪补哪，半升级的库也能补到最新。
