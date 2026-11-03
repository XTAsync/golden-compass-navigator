BEGIN;
DO $$
DECLARE u uuid := gen_random_uuid(); tx uuid; n0 bigint; n1 bigint; r jsonb; ok boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u,'aud@t.local');
  INSERT INTO public.profiles (id) VALUES (u) ON CONFLICT DO NOTHING;
  INSERT INTO public.transactions (user_id, type, amount, status, mpesa_checkout_id) VALUES (u,'deposit',400,'pending','co_aud_1') RETURNING id INTO tx;
  PERFORM public.confirm_deposit('co_aud_1', 0, 'AUD12345XY', 400);
  SET CONSTRAINTS ALL IMMEDIATE;   -- fire the deferred audit triggers now
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_audit WHERE table_name='profiles' AND user_id=u AND (after->>'wallet_balance')::numeric=400) THEN
    RAISE EXCEPTION 'wallet credit not audited'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_audit WHERE table_name='transactions' AND row_id=tx::text AND after->>'status'='confirmed') THEN
    RAISE EXCEPTION 'tx confirm not audited'; END IF;
  r := public.verify_ledger_chain();
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'chain should verify: %', r; END IF;
  r := public.verify_wallet_balances();
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'balances should verify: %', r; END IF;

  -- append-only
  BEGIN UPDATE public.ledger_audit SET op='X' WHERE id=(SELECT max(id) FROM public.ledger_audit); RAISE EXCEPTION 'update allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ledger_audit is append-only' THEN RAISE; END IF; END;
  BEGIN DELETE FROM public.ledger_audit; RAISE EXCEPTION 'delete allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ledger_audit is append-only' THEN RAISE; END IF; END;
  BEGIN TRUNCATE public.ledger_audit; RAISE EXCEPTION 'truncate allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ledger_audit is append-only' THEN RAISE; END IF; END;

  -- tamper detection: bypass the trigger as the table owner, then the verifier must flag it
  ALTER TABLE public.ledger_audit DISABLE TRIGGER ledger_audit_no_update;
  UPDATE public.ledger_audit SET after = jsonb_set(after, '{wallet_balance}', '999999') WHERE id=(SELECT max(id) FROM public.ledger_audit WHERE table_name='profiles' AND user_id=u);
  ALTER TABLE public.ledger_audit ENABLE TRIGGER ledger_audit_no_update;
  r := public.verify_ledger_chain();
  IF (r->>'ok')::boolean OR r->>'reason' <> 'bad_hash' THEN RAISE EXCEPTION 'tamper not detected: %', r; END IF;

  RAISE NOTICE 'ledger audit tests: all checks passed';
END $$;
ROLLBACK;
