BEGIN;
DO $$
DECLARE adm uuid := gen_random_uuid(); u uuid := gen_random_uuid(); tx uuid; r jsonb; bal numeric;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (adm,'a@t.local'),(u,'u@t.local');
  INSERT INTO public.profiles (id) VALUES (adm),(u) ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (adm,'admin');
  INSERT INTO public.transactions (user_id, type, amount, status, mpesa_checkout_id) VALUES (u,'deposit',300,'pending','co_res_1') RETURNING id INTO tx;
  PERFORM public.confirm_deposit('co_res_1', 0, NULL, 300);              -- held: missing_receipt
  IF public.resolve_held_deposit(tx, 'ABC12345XY', u)->>'result' <> 'forbidden' THEN RAISE EXCEPTION 'non-admin resolved'; END IF;
  IF public.resolve_held_deposit(tx, 'bad', adm)->>'result' <> 'invalid_receipt' THEN RAISE EXCEPTION 'bad receipt accepted'; END IF;
  r := public.resolve_held_deposit(tx, 'abc12345xy', adm);
  IF r->>'result' <> 'confirmed' THEN RAISE EXCEPTION 'resolve: %', r; END IF;
  SELECT wallet_balance INTO bal FROM public.profiles WHERE id = u;
  IF bal <> 300 THEN RAISE EXCEPTION 'wallet should be 300, got %', bal; END IF;
  r := public.resolve_held_deposit(tx, 'ABC12345XY', adm);
  IF r->>'result' <> 'not_resolvable' THEN RAISE EXCEPTION 'second resolve: %', r; END IF;
  SELECT wallet_balance INTO bal FROM public.profiles WHERE id = u;
  IF bal <> 300 THEN RAISE EXCEPTION 'double credit: %', bal; END IF;
  RAISE NOTICE 'resolve_held_deposit tests: all checks passed';
END $$;
ROLLBACK;
