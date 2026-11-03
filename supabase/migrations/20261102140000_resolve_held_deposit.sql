-- D10: an admin resolves a deposit Safaricom says was paid but that has no receipt (held for
-- review by reconcile or the callback) by entering the M-Pesa receipt from the statement. The
-- credit still goes through confirm_deposit, so it is atomic and credits once.
CREATE OR REPLACE FUNCTION public.resolve_held_deposit(p_tx_id uuid, p_receipt text, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx public.transactions%ROWTYPE; r jsonb; v_receipt text := upper(trim(coalesce(p_receipt, '')));
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin') THEN RETURN jsonb_build_object('result', 'forbidden'); END IF;
  IF v_receipt !~ '^[A-Z0-9]{8,14}$' THEN RETURN jsonb_build_object('result', 'invalid_receipt'); END IF;

  SELECT * INTO tx FROM public.transactions WHERE id = p_tx_id AND type = 'deposit' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  IF tx.user_id = p_admin_id THEN RETURN jsonb_build_object('result', 'self_resolve'); END IF;
  IF tx.status <> 'pending' OR tx.failure_reason IS DISTINCT FROM 'missing_receipt' OR tx.mpesa_checkout_id IS NULL THEN
    RETURN jsonb_build_object('result', 'not_resolvable', 'status', tx.status, 'reason', tx.failure_reason);
  END IF;

  r := public.confirm_deposit(tx.mpesa_checkout_id, 0, v_receipt, tx.amount);
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, metadata)
  VALUES ('admin:' || p_admin_id::text, 'deposit_resolved_by_admin', 'transaction', tx.id::text,
          jsonb_build_object('receipt', v_receipt, 'outcome', r->>'result'));
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_held_deposit(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_held_deposit(uuid, text, uuid) TO service_role;
