-- SQL tests for the PR1 money hardening migration. Run with scripts/test-sql.sh against a scratch
-- database that already has all migrations applied. Everything runs in one transaction that is
-- rolled back at the end, so it leaves no data behind. Any failed check raises and stops the run.
BEGIN;

DO $$
DECLARE
  admin_a uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid();
  member  uuid := gen_random_uuid();
  tx1 uuid; tx2 uuid; dep1 uuid; dep2 uuid; dep3 uuid;
  r jsonb; n int; st text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (admin_a, 'a@test.local'), (admin_b, 'b@test.local'), (member, 'm@test.local');
  INSERT INTO public.profiles (id) VALUES (admin_a), (admin_b), (member) ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (admin_a, 'admin'), (admin_b, 'admin');

  -- D6: self approval ----------------------------------------------------------------------
  INSERT INTO public.transactions (user_id, type, amount, status, gross_amount, reserved_at, payout_phone)
  VALUES (admin_a, 'withdrawal', 500, 'pending', 500, now(), '254712345678') RETURNING id INTO tx1;
  r := public.approve_withdrawal_start(tx1, admin_a);
  IF r->>'result' <> 'self_approval' THEN RAISE EXCEPTION 'D6: expected self_approval, got %', r; END IF;
  SELECT status INTO st FROM public.transactions WHERE id = tx1;
  IF st <> 'pending' THEN RAISE EXCEPTION 'D6: self approval changed status to %', st; END IF;
  r := public.approve_withdrawal_start(tx1, admin_b);
  IF r->>'result' <> 'ok' THEN RAISE EXCEPTION 'D6: another admin should approve, got %', r; END IF;
  r := public.approve_withdrawal_start(tx1, admin_b);
  IF r->>'result' <> 'not_allowed' THEN RAISE EXCEPTION 'D6: double approve should be refused, got %', r; END IF;
  r := public.approve_withdrawal_start(tx1, member);
  IF r->>'result' <> 'forbidden' THEN RAISE EXCEPTION 'D6: non-admin should be forbidden, got %', r; END IF;

  -- T4: a B2C timeout never refunds or fails the withdrawal --------------------------------
  r := public.record_b2c_timeout(tx1, 'queue timeout');
  IF r->>'result' <> 'recorded' THEN RAISE EXCEPTION 'T4: expected recorded, got %', r; END IF;
  SELECT status INTO st FROM public.transactions WHERE id = tx1;
  IF st <> 'processing' THEN RAISE EXCEPTION 'T4: timeout changed status to %', st; END IF;
  SELECT count(*) INTO n FROM public.audit_logs WHERE action = 'withdrawal_payout_timeout' AND entity_id = tx1::text;
  IF n <> 1 THEN RAISE EXCEPTION 'T4: expected 1 audit row, got %', n; END IF;

  -- T1: fail_deposit ----------------------------------------------------------------------
  INSERT INTO public.transactions (user_id, type, amount, status, mpesa_checkout_id)
  VALUES (member, 'deposit', 100, 'pending', 'ws_CO_fail_1') RETURNING id INTO dep1;
  r := public.fail_deposit(dep1, 'STK rejected');
  IF r->>'result' <> 'failed' THEN RAISE EXCEPTION 'T1: expected failed, got %', r; END IF;
  r := public.fail_deposit(dep1, 'again');
  IF r->>'result' <> 'already_processed' THEN RAISE EXCEPTION 'T1: repeat should be refused, got %', r; END IF;
  INSERT INTO public.transactions (user_id, type, amount, status, mpesa_checkout_id)
  VALUES (member, 'deposit', 100, 'confirmed', 'ws_CO_ok_1') RETURNING id INTO dep2;
  r := public.fail_deposit(dep2, 'late failure');
  IF r->>'result' <> 'already_processed' THEN RAISE EXCEPTION 'T1: confirmed deposit must not be failed, got %', r; END IF;
  r := public.fail_deposit(tx1, 'wrong type');
  IF r->>'result' <> 'not_a_deposit' THEN RAISE EXCEPTION 'T1: expected not_a_deposit, got %', r; END IF;
  INSERT INTO public.transactions (user_id, type, amount, status, mpesa_checkout_id)
  VALUES (member, 'deposit', 100, 'pending', 'ws_CO_cancel_1') RETURNING id INTO dep3;
  r := public.fail_deposit(dep3, 'user cancelled', true);
  IF r->>'result' <> 'cancelled' THEN RAISE EXCEPTION 'T1: expected cancelled, got %', r; END IF;

  -- T5: claim_stuck_deposits --------------------------------------------------------------
  INSERT INTO public.transactions (user_id, type, amount, status, mpesa_checkout_id, created_at)
  SELECT member, 'deposit', 10 + g, 'pending', 'ws_CO_stuck_' || g, now() - interval '30 minutes'
    FROM generate_series(1, 25) g;
  INSERT INTO public.transactions (user_id, type, amount, status, mpesa_checkout_id, created_at)
  VALUES (member, 'deposit', 5, 'pending', 'ws_CO_fresh', now());
  SELECT count(*) INTO n FROM public.claim_stuck_deposits(100);
  IF n <> 20 THEN RAISE EXCEPTION 'T5: claim should cap at 20, got %', n; END IF;
  SELECT count(*) INTO n FROM public.claim_stuck_deposits(100);
  IF n <> 5 THEN RAISE EXCEPTION 'T5: second claim should get the remaining 5, got %', n; END IF;
  SELECT count(*) INTO n FROM public.claim_stuck_deposits(100);
  IF n <> 0 THEN RAISE EXCEPTION 'T5: nothing left inside the retry window, got %', n; END IF;
  SELECT count(*) INTO n FROM public.transactions WHERE mpesa_checkout_id = 'ws_CO_fresh' AND reconcile_attempted_at IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'T5: fresh deposit must not be claimed'; END IF;

  -- T5: inbox archive ---------------------------------------------------------------------
  INSERT INTO public.mpesa_unmatched_callbacks (checkout_id, result_code, received_at) VALUES
    ('old_1', 0, now() - interval '2 days'), ('new_1', 0, now());
  n := public.archive_old_unmatched_callbacks();
  IF n <> 1 THEN RAISE EXCEPTION 'T5: expected 1 archived, got %', n; END IF;
  SELECT count(*) INTO n FROM public.mpesa_unmatched_callbacks WHERE checkout_id = 'old_1';
  IF n <> 0 THEN RAISE EXCEPTION 'T5: old row should leave the inbox'; END IF;
  SELECT count(*) INTO n FROM public.mpesa_unmatched_callbacks_archive WHERE checkout_id = 'old_1';
  IF n <> 1 THEN RAISE EXCEPTION 'T5: old row should be archived'; END IF;

  RAISE NOTICE 'PR1 SQL tests: all checks passed';
END $$;

ROLLBACK;
