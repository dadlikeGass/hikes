#!/bin/bash
# 公开读取限流与批量抓取识别验收（不改动你的数据，跑完清理计数桶与事件）。
#
# 前置：本地开发栈在跑（cd server && docker compose up -d && docker compose exec api alembic upgrade head）。
# 用法：bash server/tests/read_limit_drill.sh     # 在仓库根目录执行
#
# 覆盖：正常浏览不被误伤 / 批量读取被限速并记录 / 私有数据始终要鉴权 /
#       频繁触顶会升级为临时封禁（用第二个进程把阈值压低，不动主进程）。
set -u
API=http://localhost:8000
DB_CONTAINER=${DB_CONTAINER:-hikes-db-1}
COMPOSE="docker compose -f server/docker-compose.yml"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1  期望=$2 实际=$3"; FAIL=$((FAIL+1)); fi }
q() { docker exec "$DB_CONTAINER" psql -q -tA -U hikes -d hikes -c "$1" | tr -d '\r'; }
clean_buckets() { q "DELETE FROM auth_rate_limits WHERE bucket_key LIKE 'read%'" >/dev/null; }
clean_read_events() { q "DELETE FROM rate_limit_events WHERE scope='read'" >/dev/null; }
# curl 的 -o 是按 URL 生效的，多个 URL 必须逐个配 -o，否则响应体会被打印出来
fetch_codes() { local args=(); for u in "$@"; do args+=(-o /dev/null "$u"); done
  curl -s -w '%{http_code}\n' "${args[@]}"; }

clean_buckets
clean_read_events
T0=$(q "SELECT now()")

echo "== P1 正常浏览不被误伤（40 个公开请求，含页面加载常打的那几个接口）=="
URLS=()
for i in $(seq 1 8); do
  URLS+=("$API/api/routes" "$API/api/points?limit=20" "$API/api/peaks" "$API/api/community/recent" "$API/api/visits/recent?limit=10")
done
CODES=$(fetch_codes "${URLS[@]}" | sort | uniq -c | sed 's/^ *//' | tr '\n' ' ')
check "40 个请求全部 200" "40 200 " "$CODES"

echo "== P2 批量读取被限速并记录 =="
clean_buckets
BULK=()
for i in $(seq 1 200); do BULK+=("$API/api/routes"); done
DIST=$(fetch_codes "${BULK[@]}" | sort | uniq -c | sed 's/^ *//' | tr '\n' ' ')
echo "  分布：$DIST"
check "前 120 个 200、其余 429" "120 200 80 429 " "$DIST"
check "限流事件已落库（scope=read）" "1" \
  "$([ "$(q "SELECT count(*) FROM rate_limit_events WHERE scope='read' AND created_at >= '$T0'")" -ge 1 ] && echo 1 || echo 0)"
check "事件里只有 IP 哈希、没有明文" "1" \
  "$(q "SELECT bool_and(ip_hash ~ '^[0-9a-f]{64}\$')::int FROM rate_limit_events WHERE scope='read'")"
check "普通写入接口不受读取限流影响（限流桶只挡读）" "0" \
  "$(q "SELECT count(*) FROM auth_rate_limits WHERE bucket_key LIKE 'visit%' OR bucket_key LIKE 'comment%'")"

echo "== P3 私有数据始终要鉴权（未登录一律 401）=="
clean_buckets          # 把上一阶段的封禁/计数清掉，避免 403 掩盖真实的鉴权行为
for p in /api/me/reports /api/admin/reports /api/me/arrival-drafts /api/me/visits /api/me/hidden-comments /api/me/summits /api/admin/ads; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API$p")
  check "$p 未登录返回 401" "401" "$CODE"
done
check "游客草稿接口无令牌返回 401" "401" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/guest/arrival-draft?code=QS-TEST01")"
check "没有批量导出接口（404）" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/export")"

echo "== P4 频繁触顶升级为临时封禁（第二个进程，阈值压到每分钟 2 次、2 次触顶即封）=="
$COMPOSE exec -T -d -e RATE_LIMIT_READ_PER_MINUTE_IP=2 -e RATE_LIMIT_READ_BLOCK_AFTER_TRIPS=3 \
  -e RATE_LIMIT_READ_PER_HOUR_IP=100000 api sh -c \
  'uvicorn app.main:app --host 127.0.0.1 --port 8001 >/tmp/uv8001.log 2>&1 & echo $! > /tmp/uv8001.pid'
BOOT=0
for i in $(seq 1 10); do
  sleep 1
  [ "$($COMPOSE exec -T api curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8001/api/routes)" = "200" ] && BOOT=1 && break
done
check "第二个进程起来了" "1" "$BOOT"
SEQ=$($COMPOSE exec -T api sh -c 'for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " http://127.0.0.1:8001/api/routes; done; echo' | tr -d '\r')
echo "  6 次连续请求：$SEQ"
# 启动探测那一次请求已经占掉 1 次额度，所以下面这轮是 1 次放行
check "1 次放行、3 次 429、随后转 403 READ_BLOCKED" "200 429 429 429 403 403 " "$SEQ"
$COMPOSE exec -T api sh -c 'kill $(cat /tmp/uv8001.pid) 2>/dev/null; rm -f /tmp/uv8001.pid /tmp/uv8001.log' 2>/dev/null

echo "== P5 robots 与政策文本 =="
check "robots.txt 可访问且禁止接口" "200 1" \
  "$(curl -s -o /tmp/rb.txt -w '%{http_code}' $API/robots.txt) $(grep -c '^Disallow: /api/' /tmp/rb.txt)"
check "用户协议含自动化访问一节" "1" "$(curl -s $API/terms.html | grep -c '自动化访问与公开内容的边界')"

echo
echo "== 清理 =="
clean_buckets
clean_read_events
echo "剩余：读取桶=$(q "SELECT count(*) FROM auth_rate_limits WHERE bucket_key LIKE 'read%'") 读取事件=$(q "SELECT count(*) FROM rate_limit_events WHERE scope='read'") 留言=$(q 'SELECT count(*) FROM comments') 用户=$(q 'SELECT count(*) FROM users')"

echo
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
