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
```

首次启动会自动建表（`001_schema.sql`）。

## 三、导入线路数据

```bash
# 本地先跑分级，产物入库前需要存在
python3 ../pipeline/build.py

docker compose -f docker-compose.prod.yml exec api \
  python /srv/seeds/seed_routes.py
```

## 四、验证

```bash
curl -s https://你的域名/health
# 期望：{"ok":true,"postgis":"3.4 ...","routes":12,"segments":75,...}

curl -sI https://你的域名/p/QS-TEST01 | head -1
# 期望：HTTP/2 302

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

没恢复过的备份等于没有备份。

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

- **微信登录未接入**：`/api/auth/wechat` 还没实现，现在靠 `/api/auth/dev-login`（生产环境自动 404）。
  接入前用户无法用真实身份打卡，这一步是上线阻塞项。
- **无内容审核**：留言是明文入库的，UGC 合规要求先过机审。正式对外开放前必须补。
- **HTTPS 未配**：nginx 里 443 那段是注释，证书就绪后启用。
- **未做限流**：留言/打卡接口需要加频率限制，防刷。
