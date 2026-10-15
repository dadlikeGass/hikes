#!/bin/bash
# 写接口限流与反滥用验收（临时账号 + 临时留言，跑完自己清理）。
#
# 前置：本地开发栈在跑（cd server && docker compose up -d && docker compose exec api alembic upgrade head）、
#       点位 5071 存在。
# 用法：bash server/tests/rate_limit_drill.sh     # 在仓库根目录执行
#
# 覆盖：正常使用不被误伤 / 重复原文明确拒绝 / 身份限流 429 / 打卡同日幂等不被拦 /
#       IP 边界按设计生效（用第二个进程把 IP 阈值压到 3，避免影响主进程和其它测试）/
#       限流事件可审计 / 阈值环境变量可覆盖。
set -u
API=http://localhost:8000
DB_CONTAINER=${DB_CONTAINER:-hikes-db-1}
COMPOSE="docker compose -f server/docker-compose.yml"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1  期望=$2 实际=$3"; FAIL=$((FAIL+1)); fi }
q() { docker exec "$DB_CONTAINER" psql -q -tA -U hikes -d hikes -c "$1" | tr -d '\r'; }
ins_id() { q "WITH ins AS ($1 RETURNING id) SELECT id FROM ins"; }
STAMP=$(date +%s)
PW='DrillPassw0rd!2026'
T0=$(q "SELECT now()")

mkuser() { curl -s -X POST $API/api/auth/register -H 'Content-Type: application/json' \
  -d "{\"username\":\"rl_$1_$STAMP\",\"password\":\"$PW\",\"nickname\":\"限流演练$1\"}" | jq -r .token; }

echo "== 准备：5 个临时账号 =="
TA=$(mkuser a); TB=$(mkuser b); TC=$(mkuser c); TD=$(mkuser d); TE=$(mkuser e)
UA=$(q "SELECT id FROM users WHERE username='rl_a_$STAMP'")
check "5 个账号已建立" "5" "$(q "SELECT count(*) FROM users WHERE username LIKE 'rl\_%_$STAMP'")"

# 清掉相关计数桶：保证这次验收从零开始（注册也有 10 次/小时的 IP 限制，
# 连着跑几轮演练会先撞上它），也不给后续测试留脏额度
q "DELETE FROM auth_rate_limits WHERE bucket_key LIKE 'comment%' OR bucket_key LIKE 'visit%' \
   OR bucket_key LIKE 'report%' OR bucket_key LIKE 'register-ip%' OR bucket_key LIKE 'guest-ip%'" >/dev/null

post_comment() { curl -s -o /tmp/rl.json -w '%{http_code}' -X POST $API/api/points/5071/comments \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $1" -d "{\"text\":\"$2\"}"; }

echo
echo "== P1 正常使用不被误伤（同一人连发 3 条不同内容）=="
OK=0
for i in 1 2 3; do [ "$(post_comment "$TA" "限流演练-正常留言 $i")" = "201" ] && OK=$((OK+1)); done
check "3 条全部 201" "3" "$OK"

echo "== P2 十分钟内重复原文 =="
C=$(post_comment "$TA" "限流演练-正常留言 1")
check "返回 409 COMMENT_DUPLICATE" "409 COMMENT_DUPLICATE" "$C $(jq -r '.detail.error.code' /tmp/rl.json)"
check "重复提交没有落库成第二条" "1" \
  "$(q "SELECT count(*) FROM comments WHERE user_id=$UA AND text='限流演练-正常留言 1'")"

echo "== P3 身份限流：每身份每小时 10 条 =="
OK=0; LAST=""
for i in $(seq 4 12); do
  CODE=$(post_comment "$TA" "限流演练-第 $i 条不同内容")
  [ "$CODE" = "201" ] && OK=$((OK+1)); LAST="$CODE"
done
check "本小时内共 10 条成功、之后 429" "7 429" "$OK $LAST"
check "被拦的是限流错误码" "RATE_LIMITED" "$(jq -r '.detail.error.code' /tmp/rl.json)"

echo "== P4 打卡：同日重复是幂等，不该被限流挡住 =="
V1=$(curl -s -X POST $API/api/points/5071/visit -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TA" -d '{"source":"scan"}')
V2=$(curl -s -X POST $API/api/points/5071/visit -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TA" -d '{"source":"scan"}')
check "两次同日打卡返回同一序号" "true" "$(jq -n --arg a "$(echo "$V1" | jq -r .seq)" --arg b "$(echo "$V2" | jq -r .seq)" '$a == $b')"
check "第二次标记 isFirstVisit=false（幂等，不是被拦）" "false" "$(echo "$V2" | jq -r .isFirstVisit)"

echo "== P5 IP 边界：把 IP 阈值压到 3（第二个进程，不动主进程）=="
docker exec "$DB_CONTAINER" psql -q -U hikes -d hikes -c "DELETE FROM auth_rate_limits WHERE bucket_key LIKE 'comment-ip%'" >/dev/null
$COMPOSE exec -T -d -e RATE_LIMIT_COMMENT_PER_IP_HOUR=3 api sh -c \
  'uvicorn app.main:app --host 127.0.0.1 --port 8001 >/tmp/uv8001.log 2>&1 & echo $! > /tmp/uv8001.pid'
BOOT=0
for i in $(seq 1 10); do
  sleep 1
  [ "$($COMPOSE exec -T api curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8001/health)" = "200" ] && BOOT=1 && break
done
check "第二个进程起来了（阈值 3，走容器内 IP）" "1" "$BOOT"
CODES=$($COMPOSE exec -T -e TKS="$TB $TC $TD $TE" api sh -c \
  'for t in $TKS; do curl -s -o /dev/null -w "%{http_code} " -X POST http://127.0.0.1:8001/api/points/5071/comments -H "Content-Type: application/json" -H "Authorization: Bearer $t" -d "{\"text\":\"限流演练-IP 边界\"}"; done; echo' | tr -d '\r')
check "4 个不同身份、同一 IP：前 3 个 201、第 4 个 429" "201 201 201 429" "$(echo $CODES)"
$COMPOSE exec -T api sh -c 'kill $(cat /tmp/uv8001.pid) 2>/dev/null; rm -f /tmp/uv8001.pid /tmp/uv8001.log' 2>/dev/null

echo "== P6 限流事件可审计 =="
EV=$(q "SELECT count(*) FROM rate_limit_events WHERE scope='comment' AND created_at >= '$T0'")
check "事件表记录了本次命中（≥2 条）" "1" "$([ "$EV" -ge 2 ] && echo 1 || echo 0)"
check "事件里只存 IP 哈希、没有明文" "0" \
  "$(q "SELECT count(*) FROM rate_limit_events WHERE session_user IS NOT NULL AND ip_hash IS NOT NULL AND ip_hash !~ '^[0-9a-f]{64}$'")"
echo "（事件样本：$(q "SELECT scope||' '||coalesce(identity,'-')||' '||left(ip_hash,12)||' '||path FROM rate_limit_events ORDER BY id DESC LIMIT 1")）"

echo "== P7 阈值可用环境变量覆盖 =="
check "compose 会把 RATE_LIMIT_* 传进容器" "1" \
  "$(RATE_LIMIT_COMMENT_PER_IP_HOUR=7 $COMPOSE config | grep -c 'RATE_LIMIT_COMMENT_PER_IP_HOUR: "7"')"

echo
echo "== 清理 =="
DRILL_IDS=$(q "SELECT coalesce(string_agg(id::text, ','), '0') FROM comments WHERE text LIKE '限流演练-%'")
q "DELETE FROM comments WHERE id IN ($DRILL_IDS)" >/dev/null
q "DELETE FROM visits WHERE user_id = $UA" >/dev/null
DRILL_USERS=$(q "SELECT coalesce(string_agg(id::text, ','), '0') FROM users WHERE username LIKE 'rl\_%_$STAMP'")
q "DELETE FROM users WHERE id IN ($DRILL_USERS)" >/dev/null
q "DELETE FROM auth_rate_limits WHERE bucket_key LIKE 'comment%' OR bucket_key LIKE 'visit%' \
   OR bucket_key LIKE 'register-ip%'" >/dev/null
q "DELETE FROM rate_limit_events WHERE created_at >= '$T0'" >/dev/null
echo "剩余：留言=$(q 'SELECT count(*) FROM comments') 用户=$(q 'SELECT count(*) FROM users') 演练账号=$(q "SELECT count(*) FROM users WHERE username LIKE 'rl\_%'") 演练留言=$(q "SELECT count(*) FROM comments WHERE text LIKE '限流演练-%'") 事件=$(q 'SELECT count(*) FROM rate_limit_events')"

echo
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
