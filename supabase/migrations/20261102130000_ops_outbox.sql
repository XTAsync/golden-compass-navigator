-- E2: ops alerts. Events are written to ops_outbox inside the same transaction as the change that
-- caused them (so a direct SQL flip of a pause flag alerts too); a route drains the outbox to a
-- webhook. dedupe_key stops a hostile or noisy caller from flooding the webhook.

CREATE TABLE IF NOT EXISTS public.ops_outbox (
  id          bigserial PRIMARY KEY,
  event       text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key  text,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_outbox_dedupe_uniq ON public.ops_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_outbox_unsent_idx ON public.ops_outbox (id) WHERE sent_at IS NULL;
ALTER TABLE public.ops_outbox ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON public.ops_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ops_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_ops_event(p_event text, p_payload jsonb, p_dedupe_key text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.ops_outbox (event, payload, dedupe_key) VALUES (p_event, coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
$$;

-- Pause flag flipped (by anyone, including direct SQL).
CREATE OR REPLACE FUNCTION public.ops_flag_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.key IN ('withdrawals_paused', 'investing_paused') AND NEW.value IS DISTINCT FROM OLD.value THEN
    PERFORM public.enqueue_ops_event('pause_flag_changed',
      jsonb_build_object('flag', NEW.key, 'from', OLD.value, 'to', NEW.value));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ops_flag_changed_trg ON public.app_config;
CREATE TRIGGER ops_flag_changed_trg AFTER UPDATE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION public.ops_flag_changed();

-- A deposit held for review raises an AML flag (confirm_deposit); alert on each new flag.
CREATE OR REPLACE FUNCTION public.ops_aml_flag_added() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.enqueue_ops_event('held_for_review',
    jsonb_build_object('transaction_id', NEW.transaction_id, 'reason', NEW.flag_reason, 'amount', NEW.amount, 'severity', NEW.severity),
    'aml_flag:' || NEW.id::text);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ops_aml_flag_added_trg ON public.aml_flags;
CREATE TRIGGER ops_aml_flag_added_trg AFTER INSERT ON public.aml_flags
  FOR EACH ROW EXECUTE FUNCTION public.ops_aml_flag_added();

-- Withdrawals stuck in 'processing': one alert per withdrawal per day.
CREATE OR REPLACE FUNCTION public.enqueue_stuck_withdrawals(p_minutes integer DEFAULT 30)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; r record;
BEGIN
  FOR r IN SELECT id, amount, user_id FROM public.transactions
            WHERE type = 'withdrawal' AND status = 'processing'
              AND created_at < now() - make_interval(mins => greatest(p_minutes, 1))
            LIMIT 50 LOOP
    PERFORM public.enqueue_ops_event('withdrawal_stuck',
      jsonb_build_object('transaction_id', r.id, 'amount', r.amount, 'minutes', p_minutes),
      'stuck:' || r.id::text || ':' || to_char(now(), 'YYYY-MM-DD'));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Drain: claim unsent events (skip locked, at most 5 attempts), then mark them.
CREATE OR REPLACE FUNCTION public.claim_ops_events(p_limit integer DEFAULT 20)
RETURNS TABLE (id bigint, event text, payload jsonb, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH picked AS (
    SELECT o.id FROM public.ops_outbox o
     WHERE o.sent_at IS NULL AND o.attempts < 5
     ORDER BY o.id LIMIT least(greatest(p_limit, 1), 50) FOR UPDATE SKIP LOCKED)
  UPDATE public.ops_outbox o SET attempts = o.attempts + 1 FROM picked WHERE o.id = picked.id
  RETURNING o.id, o.event, o.payload, o.created_at
$$;
CREATE OR REPLACE FUNCTION public.mark_ops_events_sent(p_ids bigint[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ops_outbox SET sent_at = now() WHERE id = ANY (p_ids)
$$;

REVOKE ALL ON FUNCTION public.enqueue_ops_event(text, jsonb, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_stuck_withdrawals(integer)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_ops_events(integer)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_ops_events_sent(bigint[])        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ops_event(text, jsonb, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_stuck_withdrawals(integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ops_events(integer)             TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_ops_events_sent(bigint[])        TO service_role;
