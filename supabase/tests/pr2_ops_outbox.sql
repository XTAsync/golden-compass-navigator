BEGIN;
DO $$
DECLARE u uuid := gen_random_uuid(); tx uuid; n int; m int; ids bigint[];
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u, 'o@t.local');
  INSERT INTO public.profiles (id) VALUES (u) ON CONFLICT DO NOTHING;
  DELETE FROM public.ops_outbox;

  -- pause flag flip is alerted, an unchanged value is not
  UPDATE public.app_config SET value = 'true'::jsonb WHERE key = 'withdrawals_paused';
  UPDATE public.app_config SET value = 'true'::jsonb WHERE key = 'withdrawals_paused';
  SELECT count(*) INTO n FROM public.ops_outbox WHERE event = 'pause_flag_changed';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 pause alert, got %', n; END IF;
  UPDATE public.app_config SET value = 'false'::jsonb WHERE key = 'withdrawals_paused';

  -- held for review alerts once per flag
  INSERT INTO public.transactions (user_id, type, amount, status, mpesa_checkout_id)
  VALUES (u, 'deposit', 100, 'pending', 'co_ops_1') RETURNING id INTO tx;
  PERFORM public.confirm_deposit('co_ops_1', 0, NULL, 100);   -- missing receipt -> flag
  SELECT count(*) INTO n FROM public.ops_outbox WHERE event = 'held_for_review';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 held alert, got %', n; END IF;

  -- stuck withdrawal: once per day even if scanned twice
  INSERT INTO public.transactions (user_id, type, amount, status, created_at, gross_amount, reserved_at)
  VALUES (u, 'withdrawal', 500, 'processing', now() - interval '2 hours', 500, now());
  PERFORM public.enqueue_stuck_withdrawals(30); PERFORM public.enqueue_stuck_withdrawals(30);
  SELECT count(*) INTO n FROM public.ops_outbox WHERE event = 'withdrawal_stuck';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 stuck alert, got %', n; END IF;

  -- dedupe key blocks a flood
  FOR i IN 1..5 LOOP PERFORM public.enqueue_ops_event('callback_rejected', '{}', 'cb:abc:2026-11-01T10'); END LOOP;
  SELECT count(*) INTO n FROM public.ops_outbox WHERE event = 'callback_rejected';
  IF n <> 1 THEN RAISE EXCEPTION 'dedupe failed, got %', n; END IF;

  -- drain: claim, mark sent, nothing left
  SELECT count(*) INTO m FROM public.claim_ops_events(50);
  SELECT array_agg(id) INTO ids FROM public.ops_outbox;
  PERFORM public.mark_ops_events_sent(ids);
  SELECT count(*) INTO n FROM public.claim_ops_events(50);
  IF m < 4 OR n <> 0 THEN RAISE EXCEPTION 'drain wrong: claimed %, left %', m, n; END IF;
  RAISE NOTICE 'ops outbox tests: all checks passed';
END $$;
ROLLBACK;
