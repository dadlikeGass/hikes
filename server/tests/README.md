# V3 验收 Drill

V3 的验收用例都在这个目录，用 Python `unittest` + 已有 `httpx` 写，跑在**隔离环境**里，
不碰你本机 8000/5432 的开发库，也不碰生产。

## 一、起隔离环境（T1 要求独立项目、独立卷、独立端口）

```bash
# 仓库根目录执行
docker compose -f server/docker-compose.v3-test.yml up -d
docker compose -f server/docker-compose.v3-test.yml exec -T api alembic upgrade head
```

* API：http://127.0.0.1:18000 （容器内 8000）
* Postgres：127.0.0.1:15432 ，库名 hikes ，独立卷 `hikes-v3test_v3testdbdata`
* 与开发栈是两个 compose 项目：`hikes-v3test` 与 `hikes`，容器名、卷、端口都不共用

数据要不要种子？**不需要**。drill 自己造点位、山头、账号、游客，用完按前缀清理
（`v3_common.purge`），所以隔离库里可以一直是干净的。

## 二、跑 drill

```bash
# 仓库根目录执行；V3_TEST_BASE_URL 必须是本机回环地址，脚本会拒绝其它地址
V3_TEST_BASE_URL=http://127.0.0.1:18000 \
  python3 -m unittest discover -s server/tests -p 'v3_*_drill.py' -v
```

只想跑一个：

```bash
V3_TEST_BASE_URL=http://127.0.0.1:18000 python3 -m unittest discover -s server/tests -p 'v3_checkin_drill.py' -v
```

宿主机需要 `httpx`（`python3 -m pip install --user httpx`）。数据库核对不走本机 psql，
而是 `docker compose exec db psql`，所以本机不需要装 Postgres 客户端。

## 三、旧库副本升级验收（T1 / A14）

```bash
# 默认读 .local-backups/hikes-before-v3-2026-10-16.dump；也可以自己指定
V3_LEGACY_DUMP=/path/to/before-v3.dump \
  V3_TEST_BASE_URL=http://127.0.0.1:18000 \
  python3 -m unittest discover -s server/tests -p 'v3_schema_drill.py' -v
```

没有备份文件时这条用例会 `skip`，其余用例照跑。副本库叫 `v3legacy`，只建在隔离实例里。

## 四、几个刻意的设计

* **环境守卫**：drill 开始前往隔离库插一条点位，再看 HTTP 侧 `/health` 的点位数有没有
  同步变化。对不上就说明 `V3_TEST_BASE_URL` 指到了别的环境，立刻报错退出。
* **清空限流计数**：注册 10 次/IP/小时、领游客身份 30 次/IP/小时是写死的安全阈值。
  drill 一份用例要造十几个身份，不清零会把自己挡住，测出来的失败和产品无关。
  `prepare_env()` 会清 `auth_rate_limits`，它只动计数器，不动业务数据。
* **本机代理**：httpx 会读 macOS 系统代理（本机是 127.0.0.1:7890），回环请求会被塞进
  代理然后超时。drill 的 client 一律 `trust_env=False`。
* **前缀清理**：`v3_common.purge(prefix)` 按前缀删点位 / 山头 / 账号 / 游客 / 到访 /
  成绩 / 回执 / 信件，先删引用方，避免 FK RESTRICT 挡住清理。

## 五、清理隔离环境

```bash
docker compose -f server/docker-compose.v3-test.yml down -v
```

`-v` 会删掉隔离数据卷（只删 `hikes-v3test_v3testdbdata`，开发栈的 `hikes_dbdata` 不受影响）。
