-- SQL tests for the PR2 migration. Run with scripts/test-sql.sh on a scratch database. One
-- transaction, rolled back at the end.
BEGIN;
DO $$
DECLARE
  adm uuid := gen_random_uuid(); adm2 uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  pool uuid; r jsonb; n numeric; rid uuid; rid2 uuid; tx uuid; created timestamptz;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (adm,'a@t.local'),(adm2,'a2@t.local'),(u,'u@t.local');
  INSERT INTO public.profiles (id) VALUES (adm),(adm2),(u) ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (adm,'admin'),(adm2,'admin');
  UPDATE public.profiles SET wallet_balance = 10000 WHERE id = u;
  SELECT id INTO pool FROM public.investment_pools ORDER BY created_at LIMIT 1;
  UPDATE public.investment_pools SET is_active = true, min_investment = 100, exit_fee_percent = 1.5,
         holding_period_days = 30, current_nav = 100 WHERE id = pool;

  -- E7 / E3-1: one fee rule, whole shillings, rounded UP ------------------------------------
  r := public.withdrawal_quote('wallet', NULL, 1000);
  IF r->>'result' <> 'ok' OR (r->>'fee')::numeric <> 0 OR (r->>'net')::numeric <> 1000 THEN RAISE EXCEPTION 'wallet quote: %', r; END IF;
  r := public.withdrawal_quote('pool', pool, 1001);   -- 1.5% of 1001 = 15.015 -> 16
  IF (r->>'fee')::numeric <> 16 OR (r->>'net')::numeric <> 985 THEN RAISE EXCEPTION 'pool quote rounding: %', r; END IF;
  IF public.withdrawal_quote('wallet', NULL, 1000.5)->>'result' <> 'invalid_amount' THEN RAISE EXCEPTION 'fractional amount accepted'; END IF;
  IF public.withdrawal_quote('wallet', NULL, 50)->>'result' <> 'below_min' THEN RAISE EXCEPTION 'below min accepted'; END IF;

  -- T8: invest_in_pool ------------------------------------------------------------------------
  rid := gen_random_uuid();
  r := public.invest_in_pool(u, pool, 2000, rid);
  IF r->>'result' <> 'ok' OR (r->>'new_balance')::numeric <> 8000 THEN RAISE EXCEPTION 'invest: %', r; END IF;
  r := public.invest_in_pool(u, pool, 2000, rid);
  IF r->>'result' <> 'replayed' THEN RAISE EXCEPTION 'invest replay: %', r; END IF;
  SELECT wallet_balance INTO n FROM public.profiles WHERE id = u;
  IF n <> 8000 THEN RAISE EXCEPTION 'replay changed balance to %', n; END IF;
  UPDATE public.user_investments SET created_at = now() - interval '10 days' WHERE user_id = u AND pool_id = pool;
  SELECT created_at INTO created FROM public.user_investments WHERE user_id = u AND pool_id = pool;
  r := public.invest_in_pool(u, pool, 1000, gen_random_uuid());
  IF r->>'result' <> 'ok' THEN RAISE EXCEPTION 'top-up: %', r; END IF;
  IF (SELECT created_at FROM public.user_investments WHERE user_id = u AND pool_id = pool) <> created THEN
    RAISE EXCEPTION 'DR2: top-up moved the unlock date'; END IF;
  IF public.invest_in_pool(u, pool, 50)->>'result' <> 'below_min' THEN RAISE EXCEPTION 'invest below min'; END IF;
  IF public.invest_in_pool(u, pool, 999999)->>'result' <> 'insufficient_wallet' THEN RAISE EXCEPTION 'invest overspend'; END IF;
  UPDATE public.app_config SET value = 'true'::jsonb WHERE key = 'investing_paused';
  IF public.invest_in_pool(u, pool, 500)->>'result' <> 'paused' THEN RAISE EXCEPTION 'investing pause ignored'; END IF;
  UPDATE public.app_config SET value = 'false'::jsonb WHERE key = 'investing_paused';

  -- Pool withdrawal: lock (10 days held of 30), then unlocked -----------------------------------
  r := public.request_withdrawal(u, pool, 1000, '254712345678');
  IF r->>'result' <> 'locked' THEN RAISE EXCEPTION 'lock ignored: %', r; END IF;
  UPDATE public.user_investments SET created_at = now() - interval '40 days' WHERE user_id = u AND pool_id = pool;
  r := public.request_withdrawal(u, pool, 1000, '254712345678', NULL, 999);   -- wrong expected net
  IF r->>'result' <> 'quote_changed' OR (r->>'net')::numeric <> 985 THEN RAISE EXCEPTION 'quote_changed: %', r; END IF;
  rid2 := gen_random_uuid();
  r := public.request_withdrawal(u, pool, 1000, '254712345678', rid2, 985);   -- 1.5% of 1000 = 15 -> net 985
  IF r->>'result' <> 'ok' OR (r->>'fee')::numeric <> 15 THEN RAISE EXCEPTION 'pool withdrawal: %', r; END IF;
  r := public.request_withdrawal(u, pool, 1000, '254712345678', rid2, 985);
  IF r->>'result' <> 'replayed' THEN RAISE EXCEPTION 'withdraw replay: %', r; END IF;
  IF (SELECT count(*) FROM public.transactions WHERE user_id = u AND request_id = rid2) <> 1 THEN RAISE EXCEPTION 'replay made a second row'; END IF;

  -- Caps ---------------------------------------------------------------------------------------
  UPDATE public.app_config SET value = '1500'::jsonb WHERE key = 'withdraw_cap_user_daily';
  r := public.request_wallet_withdrawal(u, 1000, '254712345678');   -- 1000 already used today
  IF r->>'result' <> 'over_user_cap' THEN RAISE EXCEPTION 'user cap: %', r; END IF;
  UPDATE public.app_config SET value = '100000'::jsonb WHERE key = 'withdraw_cap_user_daily';
  UPDATE public.app_config SET value = '1500'::jsonb WHERE key = 'withdraw_cap_global_daily';
  IF public.request_wallet_withdrawal(u, 1000, '254712345678')->>'result' <> 'over_global_cap' THEN RAISE EXCEPTION 'global cap'; END IF;
  UPDATE public.app_config SET value = '1000000'::jsonb WHERE key = 'withdraw_cap_global_daily';

  -- T9/T11: wallet withdrawal, fail refunds the wallet exactly once ---------------------------------
  SELECT wallet_balance INTO n FROM public.profiles WHERE id = u;   -- 7000 after investing 3000
  r := public.request_wallet_withdrawal(u, 2000, '254712345678', gen_random_uuid(), 2000);
  IF r->>'result' <> 'ok' THEN RAISE EXCEPTION 'wallet withdrawal: %', r; END IF;
  tx := (r->>'transaction_id')::uuid;
  IF (SELECT wallet_balance FROM public.profiles WHERE id = u) <> n - 2000 THEN RAISE EXCEPTION 'wallet not debited'; END IF;
  IF public.request_wallet_withdrawal(u, 90000, '254712345678')->>'result' <> 'insufficient_wallet' THEN RAISE EXCEPTION 'wallet overdraw'; END IF;
  r := public.fail_withdrawal(tx, 'test', ARRAY['pending','processing']);
  IF r->>'result' <> 'failed' OR NOT (r->>'refunded')::boolean THEN RAISE EXCEPTION 'wallet refund: %', r; END IF;
  IF (SELECT wallet_balance FROM public.profiles WHERE id = u) <> n THEN RAISE EXCEPTION 'wallet refund wrong amount'; END IF;
  r := public.fail_withdrawal(tx, 'again', ARRAY['pending','processing']);
  IF r->>'result' <> 'not_allowed' THEN RAISE EXCEPTION 'double refund: %', r; END IF;
  IF (SELECT wallet_balance FROM public.profiles WHERE id = u) <> n THEN RAISE EXCEPTION 'double refund changed balance'; END IF;

  -- E1: pause stops requests and approvals ---------------------------------------------------------
  r := public.request_wallet_withdrawal(u, 1000, '254712345678');
  tx := (r->>'transaction_id')::uuid;
  UPDATE public.app_config SET value = 'true'::jsonb WHERE key = 'withdrawals_paused';
  IF public.request_wallet_withdrawal(u, 1000, '254712345678')->>'result' <> 'paused' THEN RAISE EXCEPTION 'withdraw pause ignored'; END IF;
  IF public.approve_withdrawal_start(tx, adm)->>'result' <> 'paused' THEN RAISE EXCEPTION 'approve pause ignored'; END IF;
  DELETE FROM public.app_config WHERE key = 'withdrawals_paused';   -- missing row fails closed
  IF public.cfg_paused('withdrawals_paused') IS NOT TRUE THEN RAISE EXCEPTION 'missing flag should count as paused'; END IF;
  INSERT INTO public.app_config (key, value) VALUES ('withdrawals_paused', 'false'::jsonb);
  IF public.approve_withdrawal_start(tx, adm)->>'result' <> 'ok' THEN RAISE EXCEPTION 'approve after unpause'; END IF;

  -- T13: money_config -----------------------------------------------------------------------------------
  r := public.money_config(u, 'wallet', NULL, 1000);
  IF r#>>'{quote,net}' <> '1000' OR (r#>>'{pending,withdrawals_pending}')::numeric < 1000 OR r#>>'{paused,withdrawals}' <> 'false' THEN
    RAISE EXCEPTION 'money_config: %', r; END IF;
  RAISE NOTICE 'PR2 SQL tests: all checks passed';
END $$;
ROLLBACK;
