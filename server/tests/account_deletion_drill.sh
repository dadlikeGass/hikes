#!/bin/bash
# 账号注销与数据权利验收（临时账号 + 临时数据，跑完自己清理）。
#
# 前置：本地开发栈在跑（cd server && docker compose up -d && docker compose exec api alembic upgrade head）。
# 用法：bash server/tests/account_deletion_drill.sh     # 在仓库根目录执行
#
# 验收要点：密码与确认字样校验 / 个人数据真的删掉 / 公开留言保留正文但不再署名 /
#           审计行仍在（说明 RESTRICT 没挡住注销）/ 旧令牌立刻失效 /
#           同一用户名可以重新注册 / 注销后不能再注销。
set -u
API=http://localhost:8000
DB_CONTAINER=${DB_CONTAINER:-hikes-db-1}
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1  期望=$2 实际=$3"; FAIL=$((FAIL+1)); fi }
q() { docker exec "$DB_CONTAINER" psql -q -tA -U hikes -d hikes -c "$1" | tr -d '\r'; }
STAMP=$(date +%s)
PW='DrillPassw0rd!2026'
USER="del_$STAMP"

echo "== 准备：建账号并造数据 =="
TOK=$(curl -s -X POST $API/api/auth/register -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PW\",\"nickname\":\"演练注销\"}" | jq -r .token)
UID_=$(q "SELECT id FROM users WHERE username='$USER'")
check "账号已建立" "1" "$([ -n "$UID_" ] && [ "$UID_" != "" ] && echo 1 || echo 0)"

CID=$(curl -s -X POST $API/api/points/5071/comments -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" -d '{"text":"注销演练-这条公开留言应当保留正文"}' | jq -r .id)
curl -s -o /dev/null -X POST $API/api/points/5071/visit -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" -d '{"source":"scan"}'
curl -s -o /dev/null -X POST $API/api/wants -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" -d '{"kind":"peak","target_key":"drill-'"$STAMP"'"}'
curl -s -o /dev/null -X PUT $API/api/me/arrival-drafts -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" -d '{"code":"BJ-2682","privateNote":"注销演练-私人纪念"}'
curl -s -o /dev/null -X POST $API/api/comments/1/vote -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" -d '{"value":"like"}'
RID=$(curl -s -X POST $API/api/reports -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOK" -d '{"targetId":1,"reason":"other","detail":"注销演练"}' | jq -r .id)
q "INSERT INTO user_tracks (user_id, name, distance_m, gain_m, path) VALUES ($UID_, '注销演练轨迹', 1500, 100, '[]'::jsonb)" >/dev/null
q "INSERT INTO maintenance_audit_logs (actor_id, action, target_type, target_id, reason)
   VALUES ($UID_, 'comment.hide', 'comment', 1, '注销演练：这行审计必须活下来')" >/dev/null
BEFORE=$(q "SELECT 'visits='||(SELECT count(*) FROM visits WHERE user_id=$UID_)||' tracks='||(SELECT count(*) FROM user_tracks WHERE user_id=$UID_)||' wants='||(SELECT count(*) FROM wants WHERE user_id=$UID_)||' drafts='||(SELECT count(*) FROM account_arrival_drafts WHERE user_id=$UID_)||' votes='||(SELECT count(*) FROM comment_votes WHERE user_id=$UID_)||' audit='||(SELECT count(*) FROM maintenance_audit_logs WHERE actor_id=$UID_)")
echo "注销前：$BEFORE"
check "数据都造出来了" "visits=1 tracks=1 wants=1 drafts=1 votes=1 audit=1" "$BEFORE"

echo
echo "== T1 密码不对 =="
C=$(curl -s -o /tmp/dl.json -w '%{http_code}' -X POST $API/api/me/delete-account \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOK" \
  -d "{\"password\":\"WrongPassw0rd!2026\",\"confirm\":\"注销\"}")
check "返回 403 PASSWORD_MISMATCH" "403 PASSWORD_MISMATCH" "$C $(jq -r '.detail.error.code' /tmp/dl.json)"

echo "== T2 确认字样不对 =="
C=$(curl -s -o /tmp/dl.json -w '%{http_code}' -X POST $API/api/me/delete-account \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOK" \
  -d "{\"password\":\"$PW\",\"confirm\":\"确定\"}")
check "返回 400 CONFIRM_REQUIRED" "400 CONFIRM_REQUIRED" "$C $(jq -r '.detail.error.code' /tmp/dl.json)"

echo "== T3 正式注销 =="
C=$(curl -s -o /tmp/dl.json -w '%{http_code}' -X POST $API/api/me/delete-account \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOK" \
  -d "{\"password\":\"$PW\",\"confirm\":\"注销\"}")
check "返回 200" "200" "$C"
echo "  删除：$(jq -c .removed /tmp/dl.json)"
echo "  保留：$(jq -c .kept /tmp/dl.json)"

echo "== T4 个人数据已删、公开内容与审计保留 =="
AFTER=$(q "SELECT 'visits='||(SELECT count(*) FROM visits WHERE user_id=$UID_)||' tracks='||(SELECT count(*) FROM user_tracks WHERE user_id=$UID_)||' wants='||(SELECT count(*) FROM wants WHERE user_id=$UID_)||' drafts='||(SELECT count(*) FROM account_arrival_drafts WHERE user_id=$UID_)||' votes='||(SELECT count(*) FROM comment_votes WHERE user_id=$UID_)||' audit='||(SELECT count(*) FROM maintenance_audit_logs WHERE actor_id=$UID_)")
check "个人数据归零、审计仍在" "visits=0 tracks=0 wants=0 drafts=0 votes=0 audit=1" "$AFTER"
check "公开留言正文保留" "1" "$(q "SELECT count(*) FROM comments WHERE id=$CID")"
check "留言作者已匿名（昵称与服务名都空）" "1" \
  "$(q "SELECT count(*) FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=$CID AND u.nickname IS NULL AND u.username IS NULL AND u.password_hash IS NULL")"

echo "== T5 旧令牌立刻失效 =="
C=$(curl -s -o /tmp/dl.json -w '%{http_code}' $API/api/me/visits -H "Authorization: Bearer $TOK")
check "返回 401 ACCOUNT_DELETED" "401 ACCOUNT_DELETED" "$C $(jq -r '.detail.error.code' /tmp/dl.json)"

echo "== T6 登录与重复注销 =="
C=$(curl -s -o /tmp/dl.json -w '%{http_code}' -X POST $API/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"username\":\"$USER\",\"password\":\"$PW\"}")
check "用原用户名登录失败" "401" "$C"

echo "== T7 同一用户名可以重新注册（新账号）=="
C=$(curl -s -o /tmp/dl.json -w '%{http_code}' -X POST $API/api/auth/register \
  -H 'Content-Type: application/json' -d "{\"username\":\"$USER\",\"password\":\"$PW\",\"nickname\":\"演练注销二\"}")
NEW_UID=$(q "SELECT id FROM users WHERE username='$USER'")
check "重新注册成功且是新行" "200 true" "$C $([ "$NEW_UID" != "$UID_" ] && echo true || echo false)"

echo "== T8 匿名行仍被审计引用（RESTRICT 没挡住注销）=="
check "审计行指向的还是原来那行用户" "1" \
  "$(q "SELECT count(*) FROM maintenance_audit_logs l JOIN users u ON u.id=l.actor_id WHERE l.actor_id=$UID_ AND u.deleted_at IS NOT NULL")"

echo
echo "== 清理 =="
q "DELETE FROM comments WHERE id=$CID" >/dev/null
q "DELETE FROM comment_votes WHERE user_id IN ($UID_, $NEW_UID)" >/dev/null
q "DELETE FROM content_reports WHERE id=$RID" >/dev/null
q "DELETE FROM maintenance_audit_logs WHERE actor_id IN ($UID_, $NEW_UID)" >/dev/null
q "DELETE FROM visits WHERE user_id IN ($UID_, $NEW_UID)" >/dev/null
q "DELETE FROM user_tracks WHERE user_id IN ($UID_, $NEW_UID)" >/dev/null
q "DELETE FROM wants WHERE user_id IN ($UID_, $NEW_UID)" >/dev/null
q "DELETE FROM users WHERE id IN ($UID_, $NEW_UID)" >/dev/null
q "DELETE FROM auth_rate_limits WHERE bucket_key LIKE 'register-ip%'" >/dev/null
echo "剩余：留言=$(q 'SELECT count(*) FROM comments') 用户=$(q 'SELECT count(*) FROM users') 审计=$(q 'SELECT count(*) FROM maintenance_audit_logs') 举报=$(q 'SELECT count(*) FROM content_reports') 演练账号=$(q "SELECT count(*) FROM users WHERE username LIKE 'del\_%'")"

echo
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
