-- PR2: launch controls (E1), whole-shilling fee rounding (E7), atomic pool investing (T8),
-- wallet withdrawal (T9), shared quote function (T10/E3-1), request ids (T12/E3-3) and the
-- money_config read (T13/E3-6). Additive except that request_withdrawal and fail_withdrawal are
-- replaced. Every function is callable by the server (service_role) only.
-- Lock order (matters for deadlocks): advisory 'withdraw_caps' lock, then profiles row, then
-- user_investments row, then transactions row.

-- ---------------------------------------------------------------------------
-- Config (app_config). Placeholders: the owner sets real values before go-live (checklist).
-- ---------------------------------------------------------------------------
INSERT INTO public.app_config (key, value, description) VALUES
  ('withdrawals_paused',        'false'::jsonb,  'Pause switch: true stops new withdrawal requests and approvals. Missing or non-boolean counts as paused.'),
  ('investing_paused',          'false'::jsonb,  'Pause switch: true stops new pool investments from the wallet.'),
  ('withdraw_min_kes',          '100'::jsonb,    'PLACEHOLDER: minimum withdrawal in whole KES.'),
  ('withdraw_cap_user_daily',   '100000'::jsonb, 'PLACEHOLDER: per-user withdrawal cap per day (Africa/Nairobi), KES gross.'),
  ('withdraw_cap_global_daily', '1000000'::jsonb,'PLACEHOLDER: all-users withdrawal cap per day (Africa/Nairobi), KES gross.'),
  ('wallet_withdraw_fee_percent','0'::jsonb,     'Fee on wallet-balance withdrawals, percent. 0 at launch.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cfg_num(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::numeric END
                     FROM public.app_config WHERE key = p_key), p_default)
$$;

-- Fails closed: anything but an explicit boolean false (including a missing row) is "paused".
CREATE OR REPLACE FUNCTION public.cfg_paused(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT NOT (jsonb_typeof(value) = 'boolean' AND value = 'false'::jsonb)
                     FROM public.app_config WHERE key = p_key), true)
$$;

-- ---------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS source     text;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IS NULL OR source IN ('wallet', 'pool'));
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check
  CHECK (type = ANY (ARRAY['deposit'::text, 'withdrawal'::text, 'invest'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS transactions_request_uniq
  ON public.transactions (user_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_user_open_idx
  ON public.transactions (user_id, status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS transactions_withdrawals_day_idx
  ON public.transactions (created_at) WHERE type = 'withdrawal';

-- ---------------------------------------------------------------------------
-- Shared quote: the ONE place the fee rule lives (E3-1). Whole shillings only; fee rounds UP (E7).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdrawal_quote(p_source text, p_pool_id uuid, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_min numeric := public.cfg_num('withdraw_min_kes', 100);
  v_pct numeric;
  v_fee numeric;
BEGIN
  IF p_source NOT IN ('wallet', 'pool') THEN RETURN jsonb_build_object('result', 'invalid_source'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> trunc(p_amount) THEN
    RETURN jsonb_build_object('result', 'invalid_amount', 'min', v_min);
  END IF;
  IF p_amount < v_min THEN RETURN jsonb_build_object('result', 'below_min', 'min', v_min); END IF;

  IF p_source = 'wallet' THEN
    v_pct := public.cfg_num('wallet_withdraw_fee_percent', 0);
  ELSE
    SELECT coalesce(exit_fee_percent, 0) INTO v_pct FROM public.investment_pools WHERE id = p_pool_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('result', 'pool_not_found'); END IF;
  END IF;
  v_fee := ceil(p_amount * v_pct / 100.0);
  RETURN jsonb_build_object('result', 'ok', 'gross', p_amount, 'fee', v_fee, 'net', p_amount - v_fee, 'min', v_min);
END;
$$;

-- Caps used today (Africa/Nairobi day), by gross amount, ignoring failed/cancelled requests.
CREATE OR REPLACE FUNCTION public.withdraw_cap_state(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (SELECT date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi' AS start_ts),
  u AS (SELECT coalesce(sum(coalesce(gross_amount, amount)), 0) AS used FROM public.transactions, d
         WHERE type = 'withdrawal' AND user_id = p_user_id AND created_at >= d.start_ts
           AND status IN ('pending', 'processing', 'confirmed')),
  g AS (SELECT coalesce(sum(coalesce(gross_amount, amount)), 0) AS used FROM public.transactions, d
         WHERE type = 'withdrawal' AND created_at >= d.start_ts
           AND status IN ('pending', 'processing', 'confirmed'))
  SELECT jsonb_build_object(
    'user_used', u.used, 'user_cap', public.cfg_num('withdraw_cap_user_daily', 100000),
    'user_left', greatest(0, public.cfg_num('withdraw_cap_user_daily', 100000) - u.used),
    'global_used', g.used, 'global_cap', public.cfg_num('withdraw_cap_global_daily', 1000000),
    'global_left', greatest(0, public.cfg_num('withdraw_cap_global_daily', 1000000) - g.used))
  FROM u, g
$$;

-- Summary of an existing request, for a repeat of the same request id (E3-3).
CREATE OR REPLACE FUNCTION public.request_replay(p_user_id uuid, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tx public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM public.transactions WHERE user_id = p_user_id AND request_id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('result', 'replayed', 'transaction_id', tx.id, 'type', tx.type,
    'status', tx.status, 'gross', coalesce(tx.gross_amount, tx.amount), 'fee', tx.fee_amount, 'net', tx.amount);
END;
$$;

-- ---------------------------------------------------------------------------
-- Pool withdrawal (replaces the 4-argument version): adds pause, minimum, whole shillings,
-- fee rounding up, caps, request id replay and the expected_net check.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.request_withdrawal(uuid, uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user_id uuid, p_pool_id uuid, p_amount numeric, p_phone text,
  p_request_id uuid DEFAULT NULL, p_expected_net numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pool public.investment_pools%ROWTYPE;
  inv  public.user_investments%ROWTYPE;
  q jsonb; caps jsonb; rep jsonb;
  v_fee numeric; v_net numeric; v_units numeric; v_lock integer; v_held numeric; v_tx uuid;
BEGIN
  IF p_request_id IS NOT NULL THEN  -- before any lock: a repeat must be cheap and never block
    rep := public.request_replay(p_user_id, p_request_id);
    IF rep IS NOT NULL THEN RETURN rep; END IF;
  END IF;
  IF public.cfg_paused('withdrawals_paused') THEN RETURN jsonb_build_object('result', 'paused'); END IF;

  q := public.withdrawal_quote('pool', p_pool_id, p_amount);
  IF q->>'result' <> 'ok' THEN RETURN q; END IF;
  v_fee := (q->>'fee')::numeric; v_net := (q->>'net')::numeric;
  IF p_expected_net IS NOT NULL AND p_expected_net <> v_net THEN
    RETURN jsonb_build_object('result', 'quote_changed', 'gross', p_amount, 'fee', v_fee, 'net', v_net);
  END IF;

  SELECT * INTO pool FROM public.investment_pools WHERE id = p_pool_id;

  PERFORM pg_advisory_xact_lock(hashtext('withdraw_caps'));
  caps := public.withdraw_cap_state(p_user_id);
  IF p_amount > (caps->>'user_left')::numeric THEN
    RETURN jsonb_build_object('result', 'over_user_cap', 'left', caps->'user_left');
  END IF;
  IF p_amount > (caps->>'global_left')::numeric THEN
    RETURN jsonb_build_object('result', 'over_global_cap');
  END IF;

  SELECT * INTO inv FROM public.user_investments WHERE user_id = p_user_id AND pool_id = p_pool_id FOR UPDATE;
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

  v_units := CASE WHEN coalesce(inv.current_value, 0) > 0
                  THEN round(coalesce(inv.units_owned, 0) * p_amount / inv.current_value, 4) ELSE 0 END;
  UPDATE public.user_investments
     SET current_value = current_value - p_amount,
         units_owned = greatest(0, coalesce(units_owned, 0) - v_units),
         invested_amount = greatest(0, coalesce(invested_amount, 0) - p_amount)
   WHERE id = inv.id;

  BEGIN
    INSERT INTO public.transactions
      (user_id, pool_id, type, amount, status, payout_phone, gross_amount, fee_amount, units_reserved, reserved_at, request_id, source)
    VALUES (p_user_id, p_pool_id, 'withdrawal', v_net, 'pending', p_phone, p_amount, v_fee, v_units, now(), p_request_id, 'pool')
    RETURNING id INTO v_tx;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'request_id race' USING ERRCODE = '40001';  -- rolls back the reservation; caller retries and replays
  END;

  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'withdrawal_requested', 'transaction', v_tx::text,
          jsonb_build_object('user_id', p_user_id, 'source', 'pool', 'pool_id', p_pool_id, 'gross', p_amount, 'fee', v_fee, 'net', v_net));
  RETURN jsonb_build_object('result', 'ok', 'transaction_id', v_tx, 'gross', p_amount, 'fee', v_fee, 'net', v_net);
END;
$$;

-- ---------------------------------------------------------------------------
-- Wallet withdrawal (T9/T11): debit the wallet, create the pending payout. No lock period.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_wallet_withdrawal(
  p_user_id uuid, p_amount numeric, p_phone text,
  p_request_id uuid DEFAULT NULL, p_expected_net numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q jsonb; caps jsonb; rep jsonb; v_bal numeric; v_fee numeric; v_net numeric; v_tx uuid;
BEGIN
  IF p_request_id IS NOT NULL THEN
    rep := public.request_replay(p_user_id, p_request_id);
    IF rep IS NOT NULL THEN RETURN rep; END IF;
  END IF;
  IF public.cfg_paused('withdrawals_paused') THEN RETURN jsonb_build_object('result', 'paused'); END IF;

  q := public.withdrawal_quote('wallet', NULL, p_amount);
  IF q->>'result' <> 'ok' THEN RETURN q; END IF;
  v_fee := (q->>'fee')::numeric; v_net := (q->>'net')::numeric;
  IF p_expected_net IS NOT NULL AND p_expected_net <> v_net THEN
    RETURN jsonb_build_object('result', 'quote_changed', 'gross', p_amount, 'fee', v_fee, 'net', v_net);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('withdraw_caps'));
  caps := public.withdraw_cap_state(p_user_id);
  IF p_amount > (caps->>'user_left')::numeric THEN
    RETURN jsonb_build_object('result', 'over_user_cap', 'left', caps->'user_left');
  END IF;
  IF p_amount > (caps->>'global_left')::numeric THEN
    RETURN jsonb_build_object('result', 'over_global_cap');
  END IF;

  SELECT wallet_balance INTO v_bal FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'no_profile'); END IF;
  IF p_amount > coalesce(v_bal, 0) THEN
    RETURN jsonb_build_object('result', 'insufficient_wallet', 'max', coalesce(v_bal, 0));
  END IF;

  UPDATE public.profiles SET wallet_balance = wallet_balance - p_amount WHERE id = p_user_id;
  BEGIN
    INSERT INTO public.transactions
      (user_id, pool_id, type, amount, status, payout_phone, gross_amount, fee_amount, units_reserved, reserved_at, request_id, source)
    VALUES (p_user_id, NULL, 'withdrawal', v_net, 'pending', p_phone, p_amount, v_fee, 0, now(), p_request_id, 'wallet')
    RETURNING id INTO v_tx;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'request_id race' USING ERRCODE = '40001';
  END;

  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'withdrawal_requested', 'transaction', v_tx::text,
          jsonb_build_object('user_id', p_user_id, 'source', 'wallet', 'gross', p_amount, 'fee', v_fee, 'net', v_net));
  RETURN jsonb_build_object('result', 'ok', 'transaction_id', v_tx, 'gross', p_amount, 'fee', v_fee, 'net', v_net);
END;
$$;

-- ---------------------------------------------------------------------------
-- fail_withdrawal: same as before, plus the wallet branch (E3-4). A failed wallet withdrawal
-- gives the GROSS amount back to the wallet, once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_withdrawal(p_tx_id uuid, p_reason text, p_allowed_from text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx public.transactions%ROWTYPE; v_refunded boolean := false;
BEGIN
  SELECT * INTO tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF tx.type <> 'withdrawal' THEN RETURN jsonb_build_object('result', 'not_a_withdrawal'); END IF;
  IF tx.status <> ALL (p_allowed_from) THEN
    RETURN jsonb_build_object('result', 'not_allowed', 'status', tx.status);
  END IF;

  IF tx.reserved_at IS NOT NULL AND tx.gross_amount IS NOT NULL THEN
    IF tx.source = 'wallet' THEN
      UPDATE public.profiles SET wallet_balance = wallet_balance + tx.gross_amount WHERE id = tx.user_id;
      v_refunded := FOUND;
      IF NOT v_refunded THEN RAISE EXCEPTION 'profile % missing for wallet refund %', tx.user_id, tx.id; END IF;
    ELSIF tx.pool_id IS NOT NULL THEN
      UPDATE public.user_investments
         SET current_value   = coalesce(current_value, 0)   + tx.gross_amount,
             units_owned     = coalesce(units_owned, 0)     + tx.units_reserved,
             invested_amount = coalesce(invested_amount, 0) + tx.gross_amount
       WHERE user_id = tx.user_id AND pool_id = tx.pool_id;
      IF NOT FOUND THEN
        INSERT INTO public.user_investments (user_id, pool_id, current_value, units_owned, invested_amount)
        VALUES (tx.user_id, tx.pool_id, tx.gross_amount, tx.units_reserved, tx.gross_amount);
      END IF;
      v_refunded := true;
    END IF;
  END IF;

  UPDATE public.transactions
     SET status = 'failed', failure_reason = left(coalesce(p_reason, 'failed'), 200),
         mpesa_reference = left('FAIL: ' || coalesce(p_reason, 'failed'), 200)
   WHERE id = tx.id;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'withdrawal_failed', 'transaction', tx.id::text,
          jsonb_build_object('reason', p_reason, 'refunded', v_refunded, 'source', tx.source, 'gross', tx.gross_amount));
  RETURN jsonb_build_object('result', 'failed', 'refunded', v_refunded);
END;
$$;

-- ---------------------------------------------------------------------------
-- invest_in_pool (T8): wallet -> pool in one transaction. A top-up never changes created_at, so
-- the unlock date stays counted from the first investment (DR2). A holding that was fully
-- withdrawn (value 0) starts a new holding and a new unlock date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invest_in_pool(
  p_user_id uuid, p_pool_id uuid, p_amount numeric, p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pool public.investment_pools%ROWTYPE; inv public.user_investments%ROWTYPE;
  rep jsonb; v_bal numeric; v_units numeric; v_tx uuid; v_new_bal numeric;
BEGIN
  IF p_request_id IS NOT NULL THEN
    rep := public.request_replay(p_user_id, p_request_id);
    IF rep IS NOT NULL THEN RETURN rep; END IF;
  END IF;
  IF public.cfg_paused('investing_paused') THEN RETURN jsonb_build_object('result', 'paused'); END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount <> trunc(p_amount) THEN
    RETURN jsonb_build_object('result', 'invalid_amount');
  END IF;

  SELECT * INTO pool FROM public.investment_pools WHERE id = p_pool_id;
  IF NOT FOUND OR NOT coalesce(pool.is_active, false) THEN RETURN jsonb_build_object('result', 'pool_not_available'); END IF;
  IF p_amount < coalesce(pool.min_investment, 0) THEN
    RETURN jsonb_build_object('result', 'below_min', 'min', pool.min_investment);
  END IF;

  SELECT wallet_balance INTO v_bal FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'no_profile'); END IF;
  IF p_amount > coalesce(v_bal, 0) THEN
    RETURN jsonb_build_object('result', 'insufficient_wallet', 'max', coalesce(v_bal, 0));
  END IF;

  v_units := round(p_amount / greatest(coalesce(pool.current_nav, 100), 0.0001), 4);
  UPDATE public.profiles SET wallet_balance = wallet_balance - p_amount WHERE id = p_user_id
  RETURNING wallet_balance INTO v_new_bal;

  SELECT * INTO inv FROM public.user_investments WHERE user_id = p_user_id AND pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_investments (user_id, pool_id, invested_amount, current_value, units_owned)
    VALUES (p_user_id, p_pool_id, p_amount, p_amount, v_units);
  ELSE
    UPDATE public.user_investments
       SET invested_amount = coalesce(invested_amount, 0) + p_amount,
           current_value   = coalesce(current_value, 0) + p_amount,
           units_owned     = coalesce(units_owned, 0) + v_units,
           created_at      = CASE WHEN coalesce(inv.current_value, 0) <= 0 THEN now() ELSE inv.created_at END
     WHERE id = inv.id;
  END IF;

  BEGIN
    INSERT INTO public.transactions (user_id, pool_id, type, amount, status, confirmed_at, request_id, source)
    VALUES (p_user_id, p_pool_id, 'invest', p_amount, 'confirmed', now(), p_request_id, 'wallet')
    RETURNING id INTO v_tx;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'request_id race' USING ERRCODE = '40001';
  END;

  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'pool_invested', 'transaction', v_tx::text,
          jsonb_build_object('user_id', p_user_id, 'pool_id', p_pool_id, 'amount', p_amount, 'units', v_units));
  RETURN jsonb_build_object('result', 'ok', 'transaction_id', v_tx, 'amount', p_amount, 'units', v_units, 'new_balance', v_new_bal);
END;
$$;

-- ---------------------------------------------------------------------------
-- money_config (T13): everything the sheets need in one read. Advisory only; the RPCs above
-- re-check everything at submit. p_source/p_amount are optional (omit for the wallet screen).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.money_config(
  p_user_id uuid, p_source text DEFAULT NULL, p_pool_id uuid DEFAULT NULL, p_amount numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quote jsonb := NULL; v_bal numeric; v_pending jsonb;
BEGIN
  IF p_source IS NOT NULL AND p_amount IS NOT NULL THEN
    v_quote := public.withdrawal_quote(p_source, p_pool_id, p_amount);
  END IF;
  SELECT wallet_balance INTO v_bal FROM public.profiles WHERE id = p_user_id;
  SELECT jsonb_build_object(
    'withdrawals_pending', coalesce(sum(coalesce(gross_amount, amount)) FILTER (WHERE type = 'withdrawal' AND status IN ('pending', 'processing')), 0),
    'withdrawals_pending_count', count(*) FILTER (WHERE type = 'withdrawal' AND status IN ('pending', 'processing')),
    'deposits_pending', coalesce(sum(amount) FILTER (WHERE type = 'deposit' AND status = 'pending'), 0),
    'deposits_pending_count', count(*) FILTER (WHERE type = 'deposit' AND status = 'pending'))
    INTO v_pending
    FROM public.transactions WHERE user_id = p_user_id AND status IN ('pending', 'processing');
  RETURN jsonb_build_object(
    'quote', v_quote,
    'paused', jsonb_build_object('withdrawals', public.cfg_paused('withdrawals_paused'),
                                 'investing', public.cfg_paused('investing_paused')),
    'caps', public.withdraw_cap_state(p_user_id),
    'pending', v_pending,
    'wallet_balance', coalesce(v_bal, 0));
END;
$$;

-- ---------------------------------------------------------------------------
-- Pause also stops approvals (E1): a paused system pays nothing new out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_withdrawal_start(p_tx_id uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx public.transactions%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin') THEN
    RETURN jsonb_build_object('result', 'forbidden');
  END IF;
  IF public.cfg_paused('withdrawals_paused') THEN
    RETURN jsonb_build_object('result', 'paused');
  END IF;

  SELECT * INTO tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF tx.type <> 'withdrawal' THEN RETURN jsonb_build_object('result', 'not_a_withdrawal'); END IF;
  IF tx.user_id = p_admin_id THEN
    RETURN jsonb_build_object('result', 'self_approval');
  END IF;
  IF tx.status <> 'pending' THEN
    RETURN jsonb_build_object('result', 'not_allowed', 'status', tx.status);
  END IF;
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
-- Grants: server only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.cfg_num(text, numeric)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cfg_paused(text)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdrawal_quote(text, uuid, numeric)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdraw_cap_state(uuid)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_replay(uuid, uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal(uuid, uuid, numeric, text, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_wallet_withdrawal(uuid, numeric, text, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_withdrawal(uuid, text, text[])            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invest_in_pool(uuid, uuid, numeric, uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_config(uuid, text, uuid, numeric)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfg_num(text, numeric)                         TO service_role;
GRANT EXECUTE ON FUNCTION public.cfg_paused(text)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawal_quote(text, uuid, numeric)          TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_cap_state(uuid)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.request_replay(uuid, uuid)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, uuid, numeric, text, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_wallet_withdrawal(uuid, numeric, text, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_withdrawal(uuid, text, text[])            TO service_role;
GRANT EXECUTE ON FUNCTION public.invest_in_pool(uuid, uuid, numeric, uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION public.money_config(uuid, text, uuid, numeric)        TO service_role;
