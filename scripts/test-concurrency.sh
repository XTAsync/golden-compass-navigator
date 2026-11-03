#!/usr/bin/env bash
# Two-connection (really: eight) concurrency checks for the money functions. Uses real parallel
# psql sessions, so it needs committed data; it cleans up after itself. SCRATCH DATABASES ONLY.
# Usage: DATABASE_URL=postgres://... scripts/test-concurrency.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a scratch database (never production)}"
q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c "$1"; }
fail() { echo "FAIL: $1"; cleanup; exit 1; }
U=$(q "select gen_random_uuid()")
cleanup() { q "delete from public.transactions where user_id='$U'" >/dev/null 2>&1 || true
            q "delete from public.profiles where id='$U'" >/dev/null 2>&1 || true
            q "delete from auth.users where id='$U'" >/dev/null 2>&1 || true; }
q "insert into auth.users(id,email) values ('$U','conc@test.local')" >/dev/null
q "insert into public.profiles(id) values ('$U') on conflict do nothing" >/dev/null

# 1. Eight parallel callbacks for the same deposit credit the wallet exactly once.
q "insert into public.transactions(user_id,type,amount,status,mpesa_checkout_id) values ('$U','deposit',250,'pending','ws_CO_conc_1')" >/dev/null
for i in 1 2 3 4 5 6 7 8; do
  q "select public.confirm_deposit('ws_CO_conc_1', 0, 'RCPTCONC1', 250)" >/dev/null & 
done; wait
BAL=$(q "select wallet_balance::int from public.profiles where id='$U'")
[ "$BAL" = "250" ] || fail "wallet should be 250 after 8 parallel callbacks, got $BAL"
echo "ok: 8 parallel confirm_deposit credited once"

# 2. Four parallel reconcile claims never hand out the same row twice.
q "insert into public.transactions(user_id,type,amount,status,mpesa_checkout_id,created_at)
   select '$U','deposit',10,'pending','ws_CO_conc_c'||g, now()-interval '30 minutes' from generate_series(1,40) g" >/dev/null
TMP=$(mktemp)
for i in 1 2 3 4; do
  q "select id from public.claim_stuck_deposits(20) where mpesa_checkout_id like 'ws_CO_conc_c%'" >> "$TMP" &
done; wait
TOTAL=$(wc -l < "$TMP"); DISTINCT=$(sort -u "$TMP" | wc -l); rm -f "$TMP"
[ "$TOTAL" = "$DISTINCT" ] || fail "a row was claimed twice ($TOTAL claimed, $DISTINCT distinct)"
echo "ok: parallel claim_stuck_deposits gave out $TOTAL rows with no duplicates"

# 3. Eight parallel wallet withdrawals of 500 against a balance of 1000: exactly two succeed.
q "update public.profiles set wallet_balance = 1000 where id='$U'" >/dev/null
OUT=$(mktemp)
for i in 1 2 3 4 5 6 7 8; do
  q "select public.request_wallet_withdrawal('$U', 500, '254712345678', gen_random_uuid())->>'result'" >> "$OUT" || true &
done; wait
OKS=$(grep -c '^ok$' "$OUT" || true); rm -f "$OUT"
BAL=$(q "select wallet_balance::int from public.profiles where id='$U'")
[ "$OKS" = "2" ] && [ "$BAL" = "0" ] || fail "expected 2 ok and balance 0, got $OKS ok and balance $BAL"
echo "ok: parallel wallet withdrawals cannot overdraw (2 of 8 passed, balance 0)"

# 4. Eight parallel taps with the SAME request id make one withdrawal and debit once.
q "update public.profiles set wallet_balance = 5000 where id='$U'" >/dev/null
RID=$(q "select gen_random_uuid()")
for i in 1 2 3 4 5 6 7 8; do
  q "select public.request_wallet_withdrawal('$U', 1000, '254712345678', '$RID')" >/dev/null 2>&1 || true &
done; wait
ROWS=$(q "select count(*) from public.transactions where user_id='$U' and request_id='$RID'")
BAL=$(q "select wallet_balance::int from public.profiles where id='$U'")
[ "$ROWS" = "1" ] && [ "$BAL" = "4000" ] || fail "same request id: expected 1 row and balance 4000, got $ROWS rows and balance $BAL"
echo "ok: 8 parallel taps with one request id made one withdrawal"

# 5. Audit chain under load: many users hitting money functions at once must not deadlock, and the
#    chain must still verify afterwards, with wallet balances equal to the last audited value.
USERS=""
for i in 1 2 3 4 5 6; do
  V=$(q "select gen_random_uuid()"); USERS="$USERS $V"
  q "insert into auth.users(id,email) values ('$V','aud'||'$i'||'@test.local')" >/dev/null
  q "insert into public.profiles(id,wallet_balance) values ('$V',2000) on conflict (id) do update set wallet_balance=2000" >/dev/null
  q "insert into public.transactions(user_id,type,amount,status,mpesa_checkout_id) values ('$V','deposit',100,'pending','ws_CO_aud_$i')" >/dev/null
done
i=0
for V in $USERS; do
  i=$((i+1))
  for k in 1 2 3; do
    q "select public.confirm_deposit('ws_CO_aud_$i', 0, 'AUDRCPT$i', 100)" >/dev/null 2>&1 &
    q "select public.request_wallet_withdrawal('$V', 100, '254712345678', gen_random_uuid())" >/dev/null 2>&1 &
  done
done; wait
CH=$(q "select public.verify_ledger_chain()->>'ok'")
WB=$(q "select public.verify_wallet_balances()->>'ok'")
[ "$CH" = "true" ] || fail "audit chain broken after parallel load"
[ "$WB" = "true" ] || fail "wallet balance differs from audited value after parallel load"
for V in $USERS; do
  q "delete from public.transactions where user_id='$V'" >/dev/null; q "delete from public.profiles where id='$V'" >/dev/null; q "delete from auth.users where id='$V'" >/dev/null
done
echo "ok: parallel load across 6 users, no deadlock, chain and balances verify"
cleanup; echo "concurrency checks passed"
