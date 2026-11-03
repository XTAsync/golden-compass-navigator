-- Atomic money flows. Each function runs as ONE database transaction and locks the rows it
-- changes (SELECT ... FOR UPDATE), so retries, double clicks and parallel requests cannot
-- double-credit a deposit, double-spend a holding, double-pay a withdrawal, or double-refund.
-- All functions are callable by the server (service_role) only.
-- Additive: new columns only; no existing column, row or policy is changed.

-- ---------------------------------------------------------------------------
-- Columns the old code never stored (it refunded NET instead of GROSS, losing the exit fee)
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS gross_amount   numeric,
  ADD COLUMN IF NOT EXISTS fee_amount     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units_reserved numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_at    timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- One M-Pesa checkout id per transaction; one confirmed deposit per receipt.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_checkout_uniq
  ON public.transactions (mpesa_checkout_id) WHERE mpesa_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_deposit_receipt_uniq
  ON public.transactions (mpesa_reference)
  WHERE type = 'deposit' AND status = 'confirmed' AND mpesa_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Deposit callback: confirm (credit wallet once) / cancel / fail / hold for review
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_deposit(
  p_checkout_id text,
  p_result_code integer,
  p_receipt     text,
  p_paid_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tx         public.transactions%ROWTYPE;
  v_status   text;
  v_reason   text;
BEGIN
  SELECT * INTO tx FROM public.transactions
   WHERE mpesa_checkout_id = p_checkout_id AND type = 'deposit'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- Idempotent: only a pending deposit can be settled, and only once.
  IF tx.status <> 'pending' THEN
    RETURN jsonb_build_object('result', 'already_processed', 'status', tx.status);
  END IF;

  IF p_result_code IS DISTINCT FROM 0 THEN
    v_status := CASE WHEN p_result_code = 1032 THEN 'cancelled' ELSE 'failed' END;
    UPDATE public.transactions
       SET status = v_status, failure_reason = 'result_code_' || coalesce(p_result_code::text, 'null')
     WHERE id = tx.id;
    INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
    VALUES ('system', 'deposit_' || v_status, 'transaction', tx.id::text,
            jsonb_build_object('result_code', p_result_code));
    RETURN jsonb_build_object('result', v_status);
  END IF;

  -- Safaricom reports success: the paid amount and receipt must match what we expect.
  v_reason := CASE
    WHEN p_receipt IS NULL OR length(trim(p_receipt)) = 0 THEN 'missing_receipt'
    WHEN p_paid_amount IS NULL OR p_paid_amount <> tx.amount THEN 'amount_mismatch'
    ELSE NULL
  END;

  IF v_reason IS NULL THEN
    BEGIN
      UPDATE public.transactions
         SET status = 'confirmed', confirmed_at = now(), mpesa_reference = p_receipt, failure_reason = NULL
       WHERE id = tx.id;
    EXCEPTION WHEN unique_violation THEN
      v_reason := 'duplicate_receipt';
    END;
  END IF;

  IF v_reason IS NOT NULL THEN
    -- Do NOT credit. Keep the deposit pending and raise an AML/ops flag for a human.
    IF tx.failure_reason IS DISTINCT FROM v_reason THEN
      UPDATE public.transactions SET failure_reason = v_reason WHERE id = tx.id;
      INSERT INTO public.aml_flags (transaction_id, user_id, flag_reason, amount, severity, details)
      VALUES (tx.id, tx.user_id, 'deposit_' || v_reason, tx.amount, 'high',
              jsonb_build_object('expected', tx.amount, 'paid', p_paid_amount, 'receipt', p_receipt));
    END IF;
    RETURN jsonb_build_object('result', v_reason);
  END IF;

  UPDATE public.profiles SET wallet_balance = wallet_balance + tx.amount WHERE id = tx.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile % missing for deposit %', tx.user_id, tx.id;  -- rolls everything back
  END IF;

  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'deposit_confirmed', 'transaction', tx.id::text,
          jsonb_build_object('amount', tx.amount, 'receipt', p_receipt));
  RETURN jsonb_build_object('result', 'confirmed', 'user_id', tx.user_id, 'amount', tx.amount);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Withdrawal request: reserve units + create the pending payout in one step
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user_id uuid, p_pool_id uuid, p_amount numeric, p_phone text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pool       public.investment_pools%ROWTYPE;
  inv        public.user_investments%ROWTYPE;
  v_fee      numeric;
  v_net      numeric;
  v_units    numeric;
  v_lock     integer;
  v_held     numeric;
  v_tx       uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('result', 'invalid_amount');
  END IF;

  SELECT * INTO pool FROM public.investment_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'pool_not_found'); END IF;

  -- The row lock serialises parallel requests for the same holding.
  SELECT * INTO inv FROM public.user_investments
   WHERE user_id = p_user_id AND pool_id = p_pool_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'no_holdings'); END IF;

  IF p_amount > coalesce(inv.current_value, 0) THEN
    RETURN jsonb_build_object('result', 'insufficient_holdings', 'max', coalesce(inv.current_value, 0));
  END IF;

  v_lock := coalesce(pool.holding_period_days, 0);
  IF v_lock > 0 AND inv.created_at IS NOT NULL THEN
    v_held := extract(epoch FROM (now() - inv.created_at)) / 86400.0;
    IF v_held < v_lock THEN
      RETURN jsonb_build_object('result', 'locked', 'days_remaining', ceil(v_lock - v_held));
    END IF;
  END IF;

  v_fee   := round(p_amount * coalesce(pool.exit_fee_percent, 0) / 100.0, 2);
  v_net   := p_amount - v_fee;
  v_units := CASE WHEN coalesce(inv.current_value, 0) > 0
                  THEN round(coalesce(inv.units_owned, 0) * p_amount / inv.current_value, 4)
                  ELSE 0 END;

  UPDATE public.user_investments
     SET current_value   = current_value - p_amount,
         units_owned     = greatest(0, coalesce(units_owned, 0) - v_units),
         invested_amount = greatest(0, coalesce(invested_amount, 0) - p_amount)
   WHERE id = inv.id;

  INSERT INTO public.transactions
    (user_id, pool_id, type, amount, status, payout_phone, gross_amount, fee_amount, units_reserved, reserved_at)
  VALUES
    (p_user_id, p_pool_id, 'withdrawal', v_net, 'pending', p_phone, p_amount, v_fee, v_units, now())
  RETURNING id INTO v_tx;

  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'withdrawal_requested', 'transaction', v_tx::text,
          jsonb_build_object('user_id', p_user_id, 'pool_id', p_pool_id, 'gross', p_amount, 'fee', v_fee, 'net', v_net));

  RETURN jsonb_build_object('result', 'ok', 'transaction_id', v_tx, 'gross', p_amount, 'fee', v_fee, 'net', v_net);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Admin approval: pending -> processing exactly once, only for real reserved withdrawals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_withdrawal_start(p_tx_id uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx public.transactions%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin') THEN
    RETURN jsonb_build_object('result', 'forbidden');
  END IF;

  SELECT * INTO tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF tx.type <> 'withdrawal' THEN RETURN jsonb_build_object('result', 'not_a_withdrawal'); END IF;
  IF tx.status <> 'pending' THEN
    RETURN jsonb_build_object('result', 'not_allowed', 'status', tx.status);
  END IF;
  -- A withdrawal that did not come through request_withdrawal() (no reservation) is never paid.
  IF tx.reserved_at IS NULL OR tx.gross_amount IS NULL OR tx.gross_amount <= 0 THEN
    RETURN jsonb_build_object('result', 'not_reserved');
  END IF;

  UPDATE public.transactions SET status = 'processing' WHERE id = tx.id;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('admin:' || p_admin_id::text, 'withdrawal_approved', 'transaction', tx.id::text,
          jsonb_build_object('amount', tx.amount));

  RETURN jsonb_build_object('result', 'ok', 'transaction_id', tx.id, 'user_id', tx.user_id,
                            'amount', tx.amount, 'payout_phone', tx.payout_phone);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fail a withdrawal and give the units back, once (admin reject, B2C rejected/failed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_withdrawal(p_tx_id uuid, p_reason text, p_allowed_from text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF tx.type <> 'withdrawal' THEN RETURN jsonb_build_object('result', 'not_a_withdrawal'); END IF;
  IF tx.status <> ALL (p_allowed_from) THEN
    RETURN jsonb_build_object('result', 'not_allowed', 'status', tx.status);
  END IF;

  -- Refund the full reserved amount (GROSS, including the exit fee) - but only for withdrawals
  -- that really reserved units. Never refund a row that has no reservation.
  IF tx.reserved_at IS NOT NULL AND tx.gross_amount IS NOT NULL AND tx.pool_id IS NOT NULL THEN
    UPDATE public.user_investments
       SET current_value   = coalesce(current_value, 0)   + tx.gross_amount,
           units_owned     = coalesce(units_owned, 0)     + tx.units_reserved,
           invested_amount = coalesce(invested_amount, 0) + tx.gross_amount
     WHERE user_id = tx.user_id AND pool_id = tx.pool_id;
    IF NOT FOUND THEN
      INSERT INTO public.user_investments (user_id, pool_id, current_value, units_owned, invested_amount)
      VALUES (tx.user_id, tx.pool_id, tx.gross_amount, tx.units_reserved, tx.gross_amount);
    END IF;
  END IF;

  UPDATE public.transactions
     SET status = 'failed', failure_reason = left(coalesce(p_reason, 'failed'), 200),
         mpesa_reference = left('FAIL: ' || coalesce(p_reason, 'failed'), 200)
   WHERE id = tx.id;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'withdrawal_failed', 'transaction', tx.id::text,
          jsonb_build_object('reason', p_reason, 'refunded', tx.reserved_at IS NOT NULL, 'gross', tx.gross_amount));
  RETURN jsonb_build_object('result', 'failed', 'refunded', tx.reserved_at IS NOT NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. B2C success: processing -> confirmed, once
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_withdrawal(p_tx_id uuid, p_receipt text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF tx.type <> 'withdrawal' OR tx.status <> 'processing' THEN
    RETURN jsonb_build_object('result', 'not_allowed', 'status', tx.status);
  END IF;
  UPDATE public.transactions
     SET status = 'confirmed', confirmed_at = now(), mpesa_reference = left(p_receipt, 200)
   WHERE id = tx.id;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'withdrawal_completed', 'transaction', tx.id::text, jsonb_build_object('receipt', p_receipt));
  RETURN jsonb_build_object('result', 'confirmed');
END;
$$;

-- ---------------------------------------------------------------------------
-- Server only. Browsers (anon / authenticated) must never call these.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.confirm_deposit(text, integer, text, numeric)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal(uuid, uuid, numeric, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_withdrawal_start(uuid, uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_withdrawal(uuid, text, text[])                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_withdrawal(uuid, text)                          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_deposit(text, integer, text, numeric)         TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, uuid, numeric, text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal_start(uuid, uuid)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_withdrawal(uuid, text, text[])                   TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_withdrawal(uuid, text)                       TO service_role;
