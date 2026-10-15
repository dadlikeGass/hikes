#!/bin/bash
# 举报闭环验收（临时账号 + 临时留言，跑完自己清理）。
#
# 前置：本地开发栈在跑（cd server && docker compose up -d && docker compose exec api alembic upgrade head），
#       点位 5071 存在（脚本把它当留言的挂载点）。
# 用法：bash server/tests/report_drill.sh     # 在仓库根目录执行
#
# 证据口径：每条 PASS 都对应 docs/REMAINING_WORK_ACCEPTANCE.md「举报」一行里的验收标准。
set -u
API=http://localhost:8000
DB_CONTAINER=${DB_CONTAINER:-hikes-db-1}
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1  期望=$2 实际=$3"; FAIL=$((FAIL+1)); fi }
q() { docker exec "$DB_CONTAINER" psql -q -tA -U hikes -d hikes -c "$1" | tr -d '\r'; }
# INSERT ... RETURNING 用 CTE 包一层：否则 psql 会把 "INSERT 0 1" 一起吐出来，拼进 JSON 就成非法请求体
ins_id() { q "WITH ins AS ($1 RETURNING id) SELECT id FROM ins"; }
STAMP=$(date +%s)
PW='DrillPassw0rd!2026'
T0=$(q "SELECT now()")

reg() { curl -s -X POST $API/api/auth/register -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"password\":\"$PW\",\"nickname\":\"$2\"}"; }
post() { curl -s -o /tmp/rb.json -w '%{http_code}' -X POST "$1" -H 'Content-Type: application/json' "${@:2}"; }
post_guest() { curl -s -o /tmp/rb.json -w '%{http_code}' -X POST $API/api/reports \
  -H 'Content-Type: application/json' -H "X-Guest-Token: $GTOK" -d "$1"; }
code_of() { jq -r '.detail.error.code // empty' /tmp/rb.json; }

echo "== 准备：3 个临时账号（作者／举报人／内容审核员）=="
A=$(reg "drill_auth_$STAMP" "演练作者"); B=$(reg "drill_rep_$STAMP" "演练举报人"); C=$(reg "drill_rev_$STAMP" "演练审核员")
TA=$(echo "$A" | jq -r .token); UA=$(echo "$A" | jq -r .userId)
TB=$(echo "$B" | jq -r .token); UB=$(echo "$B" | jq -r .userId)
TC=$(echo "$C" | jq -r .token); UC=$(echo "$C" | jq -r .userId)
echo "作者=$UA 举报人=$UB 审核员=$UC"
q "INSERT INTO system_roles (user_id, role) VALUES ($UC, 'content_reviewer') ON CONFLICT DO NOTHING" >/dev/null
check "审核员角色已授予" "1" "$(q "SELECT count(*) FROM system_roles WHERE user_id=$UC AND role='content_reviewer'")"

echo "== 准备：临时留言 =="
CID_OWN=$(ins_id "INSERT INTO comments (point_id, user_id, text) VALUES (5071, $UA, '举报演练-作者自己的留言')")
CID_G1=$(ins_id "INSERT INTO comments (point_id, user_id, text) VALUES (5071, $UA, '举报演练-访客要举报的留言')")
CID_G2=$(ins_id "INSERT INTO comments (point_id, user_id, text) VALUES (5071, $UB, '举报演练-审核员自己举报的留言')")
IDS=""
for i in $(seq 1 13); do IDS="$IDS $(ins_id "INSERT INTO comments (point_id, user_id, text) VALUES (5071, $UB, '举报演练-限流用留言 $i')")"; done
echo "临时留言：自己=$CID_OWN 访客=$CID_G1 审核员=$CID_G2 限流=$(echo $IDS | tr ' ' ',')"

echo "== 准备：游客身份 =="
GTOK=$(python3 -c "import os;print(os.urandom(24).hex())")
curl -s -X POST $API/api/guest -H "X-Guest-Token: $GTOK" -o /dev/null
check "游客身份已建立" "1" "$(q "SELECT count(*) FROM guests WHERE token='$GTOK'")"

echo
echo "== T5 没有任何身份 =="
C5=$(post $API/api/reports -d "{\"targetId\":$CID_G1,\"reason\":\"spam\"}")
check "返回 401 REPORT_IDENTITY_REQUIRED" "401 REPORT_IDENTITY_REQUIRED" "$C5 $(code_of)"

echo "== T4 举报不存在的留言 =="
C4=$(post_guest "{\"targetId\":99999999,\"reason\":\"spam\"}")
check "返回 404 COMMENT_NOT_FOUND" "404 COMMENT_NOT_FOUND" "$C4 $(code_of)"

echo "== T3 举报自己的留言 =="
C3=$(post $API/api/reports -H "Authorization: Bearer $TA" -d "{\"targetId\":$CID_OWN,\"reason\":\"spam\"}")
check "返回 409 REPORT_SELF" "409 REPORT_SELF" "$C3 $(code_of)"

echo "== T1 游客举报（非公开提交）=="
C1=$(post_guest "{\"targetId\":$CID_G1,\"reason\":\"abuse\",\"detail\":\"含有辱骂内容\"}")
R1=$(jq -r .id /tmp/rb.json)
check "返回 201 且 pending" "201 pending" "$C1 $(jq -r .status /tmp/rb.json)"

echo "== T2 同一身份重复举报同一对象 =="
C2=$(post_guest "{\"targetId\":$CID_G1,\"reason\":\"abuse\"}")
check "返回 200、duplicate=true、同一条 id" "200 true $R1" "$C2 $(jq -r .duplicate /tmp/rb.json) $(jq -r .id /tmp/rb.json)"

echo "== T6 普通用户读举报队列 =="
check "返回 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' $API/api/admin/reports -H "Authorization: Bearer $TB")"

echo "== T7 审核员读队列 =="
CQ=$(curl -s -o /tmp/rq.json -w '%{http_code}' $API/api/admin/reports -H "Authorization: Bearer $TC")
check "返回 200" "200" "$CQ"
check "队列带留言原文与举报人" "举报演练-访客要举报的留言|游客" \
  "$(jq -r '.[0] | "\(.comment)|\(.reporter)"' /tmp/rq.json)"
check "队列带点位上下文" "true" "$(jq -r '.[0].pointCode != null' /tmp/rq.json)"

echo "== T8 审核员处置自己提交的举报 =="
post $API/api/reports -H "Authorization: Bearer $TC" -d "{\"targetId\":$CID_G2,\"reason\":\"spam\"}" >/dev/null
R3=$(jq -r .id /tmp/rb.json)
C8=$(post "$API/api/admin/reports/$R3/review" -H "Authorization: Bearer $TC" \
  -d '{"decision":"accepted","reason":"自己审自己应该被拦住","action":"none"}')
check "返回 403 SELF_REVIEW_FORBIDDEN" "403 SELF_REVIEW_FORBIDDEN" "$C8 $(code_of)"

echo "== T9 审核员通过并同时隐藏留言 =="
C9=$(post "$API/api/admin/reports/$R1/review" -H "Authorization: Bearer $TC" \
  -d '{"decision":"accepted","reason":"举报成立，内容不适合公开展示","action":"hide"}')
check "返回 200 accepted/comment.hide" "200 accepted comment.hide" \
  "$C9 $(jq -r .status /tmp/rb.json) $(jq -r .actionTaken /tmp/rb.json)"
check "留言已隐藏" "hidden" "$(q "SELECT status FROM comments WHERE id=$CID_G1")"
check "审计两条（comment.hide + report.review）" "2" \
  "$(q "SELECT count(*) FROM maintenance_audit_logs WHERE actor_id=$UC AND action IN ('comment.hide','report.review')")"
check "作者侧可见该隐藏并可申诉" "true" \
  "$(curl -s $API/api/me/hidden-comments -H "Authorization: Bearer $TA" | jq -r --argjson c "$CID_G1" '[.[] | select(.id==$c)][0].appealable')"

echo "== T10 重复处置同一条举报 =="
C10=$(post "$API/api/admin/reports/$R1/review" -H "Authorization: Bearer $TC" \
  -d '{"decision":"rejected","reason":"这条已经处理过了"}')
check "返回 409 REPORT_ALREADY_HANDLED" "409 REPORT_ALREADY_HANDLED" "$C10 $(code_of)"

echo "== T12 单人限流（每小时 10 条）=="
OK=0; LAST=""
for ID in $IDS; do
  CODE=$(post $API/api/reports -H "Authorization: Bearer $TA" -d "{\"targetId\":$ID,\"reason\":\"spam\"}")
  [ "$CODE" = "201" ] && OK=$((OK+1)); LAST="$CODE"
done
check "前 10 条成功、第 11 条起 429" "10 429" "$OK $LAST"

echo "== T11 只能看到自己的举报 =="
check "举报人 A 看到 10 条" "10" "$(curl -s $API/api/me/reports -H "Authorization: Bearer $TA" | jq 'length')"
check "举报人 B 看到 0 条" "0" "$(curl -s $API/api/me/reports -H "Authorization: Bearer $TB" | jq 'length')"

echo "== T14 账号注销不被举报记录挡住 =="
check "删除有举报记录的用户成功" "1" "$(q "WITH d AS (DELETE FROM users WHERE id=$UB RETURNING id) SELECT count(*) FROM d")"
check "举报的 reporter_key 仍留痕、身份外键置空" "0" \
  "$(q "SELECT count(*) FROM content_reports WHERE reporter_key='u:$UB' AND reporter_user_id IS NOT NULL")"

echo
echo "== 清理（先删审计与举报，再删身份：审计表对操作者是 RESTRICT）=="
LIST=$(echo "$CID_OWN $CID_G1 $CID_G2 $IDS" | tr ' ' ',' | sed 's/,,*/,/g; s/^,//; s/,$//')
q "DELETE FROM content_reports WHERE target_id IN ($LIST)" >/dev/null
q "DELETE FROM comments WHERE id IN ($LIST) OR text LIKE '举报演练-%'" >/dev/null
q "DELETE FROM maintenance_audit_logs WHERE actor_id IN ($UA,$UB,$UC)" >/dev/null
q "DELETE FROM system_roles WHERE user_id=$UC" >/dev/null
q "DELETE FROM users WHERE id IN ($UA,$UC)" >/dev/null
q "DELETE FROM guests WHERE token='$GTOK'" >/dev/null
q "DELETE FROM auth_rate_limits WHERE bucket_key LIKE 'report%'" >/dev/null
q "DELETE FROM rate_limit_events WHERE created_at >= '$T0'" >/dev/null
echo "剩余：留言=$(q 'SELECT count(*) FROM comments') 举报=$(q 'SELECT count(*) FROM content_reports') 用户=$(q 'SELECT count(*) FROM users') 游客=$(q 'SELECT count(*) FROM guests') 演练账号=$(q "SELECT count(*) FROM users WHERE username LIKE 'drill\_%'") 演练留言=$(q "SELECT count(*) FROM comments WHERE text LIKE '举报演练-%'")"
echo "（注册/登录的限流计数留一小时自动过期，不是内容数据）"

echo
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
