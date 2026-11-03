-- PR1 money hardening (review decisions D6, T1, T4, T5). Additive and idempotent: new columns,
-- one new table, new functions, and CREATE OR REPLACE of approve_withdrawal_start only.
-- All new functions are callable by the server (service_role) only.

-- ---------------------------------------------------------------------------
-- D6: an admin cannot approve a withdrawal they requested themselves.
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
-- T1: one function that marks a still-pending deposit failed (STK push rejected, reconcile on an
-- explicit terminal Daraja code). Never touches a deposit that is no longer pending.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_deposit(p_tx_id uuid, p_reason text, p_cancelled boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tx       public.transactions%ROWTYPE;
  v_status text := CASE WHEN p_cancelled THEN 'cancelled' ELSE 'failed' END;
BEGIN
  SELECT * INTO tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF tx.type <> 'deposit' THEN RETURN jsonb_build_object('result', 'not_a_deposit'); END IF;
  IF tx.status <> 'pending' THEN
    RETURN jsonb_build_object('result', 'already_processed', 'status', tx.status);
  END IF;

  UPDATE public.transactions
     SET status = v_status,
         failure_reason = left(coalesce(p_reason, v_status), 200),
         mpesa_reference = left(coalesce(p_reason, v_status), 200)
   WHERE id = tx.id;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'deposit_' || v_status, 'transaction', tx.id::text,
          jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('result', v_status);
END;
$$;

-- ---------------------------------------------------------------------------
-- T4: B2C queue-timeout notices. A timeout means the outcome is UNKNOWN (the payout may still
-- succeed), so this records the notice and never refunds or fails the withdrawal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_b2c_timeout(p_tx_id uuid, p_detail text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM public.transactions WHERE id = p_tx_id AND type = 'withdrawal';
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('system', 'withdrawal_payout_timeout', 'transaction', tx.id::text,
          jsonb_build_object('status', tx.status, 'detail', left(coalesce(p_detail, ''), 300),
                             'note', 'outcome unknown: reconcile against the M-Pesa statement before refunding'));
  RETURN jsonb_build_object('result', 'recorded', 'status', tx.status);
END;
$$;

-- ---------------------------------------------------------------------------
-- T5: reconcile support. Claim at most p_limit stuck pending deposits (older than p_min_age,
-- with a checkout id, not tried in the last p_retry_after). FOR UPDATE SKIP LOCKED plus the
-- attempt stamp means two overlapping runs never take the same row.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS reconcile_attempted_at timestamptz;

CREATE INDEX IF NOT EXISTS transactions_stuck_deposits_idx
  ON public.transactions (created_at)
  WHERE type = 'deposit' AND status = 'pending' AND mpesa_checkout_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_stuck_deposits(
  p_limit        integer  DEFAULT 20,
  p_min_age      interval DEFAULT interval '10 minutes',
  p_retry_after  interval DEFAULT interval '5 minutes'
) RETURNS TABLE (id uuid, mpesa_checkout_id text, amount numeric, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT t.id FROM public.transactions t
     WHERE t.type = 'deposit' AND t.status = 'pending' AND t.mpesa_checkout_id IS NOT NULL
       AND t.created_at < now() - p_min_age
       AND (t.reconcile_attempted_at IS NULL OR t.reconcile_attempted_at < now() - p_retry_after)
     ORDER BY t.created_at
     LIMIT least(greatest(p_limit, 1), 20)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.transactions t
     SET reconcile_attempted_at = now()
    FROM picked
   WHERE t.id = picked.id
  RETURNING t.id, t.mpesa_checkout_id, t.amount, t.user_id;
END;
$$;

-- Unmatched callbacks older than p_older are moved to an archive and counted, so the inbox
-- stays small and nothing is silently deleted.
CREATE TABLE IF NOT EXISTS public.mpesa_unmatched_callbacks_archive (
  checkout_id  text PRIMARY KEY,
  result_code  integer,
  receipt      text,
  paid_amount  numeric,
  received_at  timestamptz NOT NULL,
  archived_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mpesa_unmatched_callbacks_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mpesa_unmatched_callbacks_archive FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mpesa_unmatched_callbacks_archive TO service_role;

CREATE OR REPLACE FUNCTION public.archive_old_unmatched_callbacks(p_older interval DEFAULT interval '1 day')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH moved AS (
    DELETE FROM public.mpesa_unmatched_callbacks
     WHERE received_at < now() - p_older
    RETURNING checkout_id, result_code, receipt, paid_amount, received_at
  )
  INSERT INTO public.mpesa_unmatched_callbacks_archive (checkout_id, result_code, receipt, paid_amount, received_at)
  SELECT * FROM moved
  ON CONFLICT (checkout_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: server only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.approve_withdrawal_start(uuid, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_deposit(uuid, text, boolean)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_b2c_timeout(uuid, text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_stuck_deposits(integer, interval, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_old_unmatched_callbacks(interval)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal_start(uuid, uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_deposit(uuid, text, boolean)             TO service_role;
GRANT EXECUTE ON FUNCTION public.record_b2c_timeout(uuid, text)                TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_stuck_deposits(integer, interval, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_old_unmatched_callbacks(interval)     TO service_role;
