-- Smoke test for a disposable database after applying 001_standalone_baseline.sql.
-- Run as the schema owner with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/001_standalone_smoke.sql
-- The transaction is rolled back; no test user remains.
BEGIN;

DO $$
DECLARE
  test_user uuid;
  current_balance numeric;
  investor_role_count integer;
BEGIN
  INSERT INTO public.app_users(email, password_hash, full_name)
  VALUES ('migration-smoke-test@example.invalid', 'not-a-real-password-hash', 'Migration Smoke Test')
  RETURNING id INTO test_user;

  SELECT count(*) INTO investor_role_count
  FROM public.user_roles
  WHERE user_id = test_user AND role = 'investor';
  IF investor_role_count <> 1 THEN
    RAISE EXCEPTION 'New account must receive exactly one investor role';
  END IF;

  PERFORM public.credit_wallet(test_user, 100.00);
  PERFORM public.debit_wallet(test_user, 40.00);

  SELECT wallet_balance INTO current_balance
  FROM public.profiles WHERE id = test_user;
  IF current_balance <> 60.00 THEN
    RAISE EXCEPTION 'Expected wallet balance 60.00, got %', current_balance;
  END IF;

  BEGIN
    PERFORM public.credit_wallet(test_user, -1.00);
    RAISE EXCEPTION 'Expected negative credit to fail' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.debit_wallet(test_user, 100.00);
    RAISE EXCEPTION 'Expected insufficient debit to fail' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;

  SELECT wallet_balance INTO current_balance
  FROM public.profiles WHERE id = test_user;
  IF current_balance <> 60.00 THEN
    RAISE EXCEPTION 'Failed wallet operations must not change the balance';
  END IF;

  IF (SELECT count(*) FROM public.wallet_ledger WHERE user_id = test_user) <> 2 THEN
    RAISE EXCEPTION 'Only successful wallet mutations should create ledger entries';
  END IF;
END $$;

ROLLBACK;
