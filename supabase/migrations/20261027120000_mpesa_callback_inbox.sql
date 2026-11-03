-- Fixes a race in the deposit flow: Safaricom's callback can arrive BEFORE the STK route has
-- saved mpesa_checkout_id on the transaction. confirm_deposit then returns 'not_found', the
-- callback is acknowledged, Safaricom does not retry, and a paid deposit stays pending forever.
--
-- Fix: unmatched callbacks are parked in an inbox, and attach_checkout_id() replays them as soon
-- as the checkout id is saved. Both functions take the same advisory lock per checkout id, so
-- exactly one of these orderings happens and neither can miss the other:
--   (a) callback first  -> parked; attach_checkout_id finds it and settles it
--   (b) attach first    -> queue_unmatched_callback sees the transaction and settles directly

CREATE TABLE IF NOT EXISTS public.mpesa_unmatched_callbacks (
  checkout_id  text PRIMARY KEY,
  result_code  integer,
  receipt      text,
  paid_amount  numeric,
  received_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mpesa_unmatched_callbacks ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON public.mpesa_unmatched_callbacks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mpesa_unmatched_callbacks TO service_role;

CREATE OR REPLACE FUNCTION public.queue_unmatched_callback(
  p_checkout_id text,
  p_result_code integer,
  p_receipt     text,
  p_paid_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mpesa_checkout:' || p_checkout_id));

  -- The transaction may have been linked since confirm_deposit last looked: settle it now.
  IF EXISTS (SELECT 1 FROM public.transactions
              WHERE mpesa_checkout_id = p_checkout_id AND type = 'deposit') THEN
    RETURN public.confirm_deposit(p_checkout_id, p_result_code, p_receipt, p_paid_amount);
  END IF;

  INSERT INTO public.mpesa_unmatched_callbacks (checkout_id, result_code, receipt, paid_amount)
  VALUES (p_checkout_id, p_result_code, p_receipt, p_paid_amount)
  ON CONFLICT (checkout_id) DO NOTHING;  -- a duplicate callback must not overwrite the first
  RETURN jsonb_build_object('result', 'queued');
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_checkout_id(
  p_tx_id       uuid,
  p_checkout_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q       public.mpesa_unmatched_callbacks%ROWTYPE;
  settled jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mpesa_checkout:' || p_checkout_id));

  UPDATE public.transactions
     SET mpesa_checkout_id = p_checkout_id
   WHERE id = p_tx_id AND type = 'deposit' AND mpesa_checkout_id IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_attached');
  END IF;

  SELECT * INTO q FROM public.mpesa_unmatched_callbacks WHERE checkout_id = p_checkout_id FOR UPDATE;
  IF FOUND THEN
    settled := public.confirm_deposit(p_checkout_id, q.result_code, q.receipt, q.paid_amount);
    DELETE FROM public.mpesa_unmatched_callbacks WHERE checkout_id = p_checkout_id;
    RETURN jsonb_build_object('result', 'replayed', 'settlement', settled);
  END IF;

  RETURN jsonb_build_object('result', 'attached');
END;
$$;

REVOKE ALL ON FUNCTION public.queue_unmatched_callback(text, integer, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_checkout_id(uuid, text)                          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_unmatched_callback(text, integer, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_checkout_id(uuid, text)                          TO service_role;
