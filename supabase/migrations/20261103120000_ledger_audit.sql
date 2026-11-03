-- PR3 / E5: append-only, hash-chained ledger_audit written by the database in the same transaction
-- as every money change. Deferred constraint triggers on profiles (wallet balance), transactions
-- and user_investments append the rows AT COMMIT, so the chain-head lock is always the LAST lock a
-- transaction takes (fixed lock order: row locks first, chain lock last), which rules out deadlocks
-- between the money functions. service_role / table-owner rewrites are not prevented, only
-- DETECTED by verify_ledger_chain() and verify_wallet_balances().

CREATE TABLE IF NOT EXISTS public.ledger_audit (
  id          bigint PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  table_name  text NOT NULL,
  op          text NOT NULL,          -- I insert, U update, S snapshot
  row_id      text NOT NULL,
  user_id     uuid,
  before      jsonb,
  after       jsonb,
  prev_hash   text NOT NULL,
  hash        text NOT NULL
);
CREATE SEQUENCE IF NOT EXISTS public.ledger_audit_id_seq OWNED BY public.ledger_audit.id;
CREATE INDEX IF NOT EXISTS ledger_audit_at_idx ON public.ledger_audit (at);
CREATE INDEX IF NOT EXISTS ledger_audit_user_idx ON public.ledger_audit (user_id, id);
ALTER TABLE public.ledger_audit ENABLE ROW LEVEL SECURITY;   -- no policies: server only
REVOKE ALL ON public.ledger_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ledger_audit TO service_role;

-- Append-only: block UPDATE, DELETE and TRUNCATE for every role.
CREATE OR REPLACE FUNCTION public.ledger_audit_block() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger_audit is append-only'; END $$;
DROP TRIGGER IF EXISTS ledger_audit_no_update ON public.ledger_audit;
CREATE TRIGGER ledger_audit_no_update BEFORE UPDATE OR DELETE ON public.ledger_audit
  FOR EACH ROW EXECUTE FUNCTION public.ledger_audit_block();
DROP TRIGGER IF EXISTS ledger_audit_no_truncate ON public.ledger_audit;
CREATE TRIGGER ledger_audit_no_truncate BEFORE TRUNCATE ON public.ledger_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_audit_block();

CREATE OR REPLACE FUNCTION public.ledger_row_hash(
  p_prev text, p_id bigint, p_at timestamptz, p_table text, p_op text, p_row_id text, p_user uuid, p_before jsonb, p_after jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    p_prev || '|' || p_id::text || '|' || to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    p_table || '|' || p_op || '|' || p_row_id || '|' || coalesce(p_user::text, '') || '|' ||
    coalesce(p_before::text, '') || '|' || coalesce(p_after::text, ''), 'UTF8')), 'hex')
$$;

-- The one writer. Takes the chain-head lock, so call it only at commit time (deferred triggers).
CREATE OR REPLACE FUNCTION public.ledger_append(
  p_table text, p_op text, p_row_id text, p_user uuid, p_before jsonb, p_after jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev text; v_id bigint; v_at timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ledger_chain'));
  SELECT hash INTO v_prev FROM public.ledger_audit ORDER BY id DESC LIMIT 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  v_id := nextval('public.ledger_audit_id_seq');
  INSERT INTO public.ledger_audit (id, at, table_name, op, row_id, user_id, before, after, prev_hash, hash)
  VALUES (v_id, v_at, p_table, p_op, p_row_id, p_user, p_before, p_after, v_prev,
          public.ledger_row_hash(v_prev, v_id, v_at, p_table, p_op, p_row_id, p_user, p_before, p_after));
END $$;

CREATE OR REPLACE FUNCTION public.ledger_audit_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b jsonb; a jsonb; uid uuid; rid text;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    a := jsonb_build_object('wallet_balance', NEW.wallet_balance); uid := NEW.id; rid := NEW.id::text;
    IF TG_OP = 'UPDATE' THEN
      b := jsonb_build_object('wallet_balance', OLD.wallet_balance);
      IF OLD.wallet_balance IS NOT DISTINCT FROM NEW.wallet_balance THEN RETURN NULL; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'transactions' THEN
    a := jsonb_build_object('type', NEW.type, 'amount', NEW.amount, 'status', NEW.status, 'gross', NEW.gross_amount,
                            'fee', NEW.fee_amount, 'source', NEW.source, 'pool_id', NEW.pool_id, 'request_id', NEW.request_id);
    uid := NEW.user_id; rid := NEW.id::text;
    IF TG_OP = 'UPDATE' THEN
      b := jsonb_build_object('type', OLD.type, 'amount', OLD.amount, 'status', OLD.status, 'gross', OLD.gross_amount,
                              'fee', OLD.fee_amount, 'source', OLD.source, 'pool_id', OLD.pool_id, 'request_id', OLD.request_id);
      IF a = b THEN RETURN NULL; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'user_investments' THEN
    a := jsonb_build_object('pool_id', NEW.pool_id, 'units', NEW.units_owned, 'invested', NEW.invested_amount, 'value', NEW.current_value);
    uid := NEW.user_id; rid := NEW.id::text;
    IF TG_OP = 'UPDATE' THEN
      b := jsonb_build_object('pool_id', OLD.pool_id, 'units', OLD.units_owned, 'invested', OLD.invested_amount, 'value', OLD.current_value);
      IF a = b THEN RETURN NULL; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'mpesa_unmatched_callbacks_archive' THEN
    a := to_jsonb(NEW); rid := NEW.checkout_id; uid := NULL;
  ELSE
    RETURN NULL;
  END IF;
  PERFORM public.ledger_append(TG_TABLE_NAME, CASE TG_OP WHEN 'INSERT' THEN 'I' ELSE 'U' END, rid, uid, b, a);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS ledger_audit_profiles ON public.profiles;
CREATE CONSTRAINT TRIGGER ledger_audit_profiles AFTER INSERT OR UPDATE ON public.profiles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_audit_capture();
DROP TRIGGER IF EXISTS ledger_audit_transactions ON public.transactions;
CREATE CONSTRAINT TRIGGER ledger_audit_transactions AFTER INSERT OR UPDATE ON public.transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_audit_capture();
DROP TRIGGER IF EXISTS ledger_audit_investments ON public.user_investments;
CREATE CONSTRAINT TRIGGER ledger_audit_investments AFTER INSERT OR UPDATE ON public.user_investments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_audit_capture();
DROP TRIGGER IF EXISTS ledger_audit_archive ON public.mpesa_unmatched_callbacks_archive;
CREATE CONSTRAINT TRIGGER ledger_audit_archive AFTER INSERT ON public.mpesa_unmatched_callbacks_archive
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_audit_capture();

-- Starting point: one snapshot row per existing wallet, so "balance equals last audited value"
-- holds from day one. Skipped when the table already has rows (re-running the migration).
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ledger_audit) THEN
    FOR r IN SELECT id, wallet_balance FROM public.profiles ORDER BY id LOOP
      PERFORM public.ledger_append('profiles', 'S', r.id::text, r.id, NULL, jsonb_build_object('wallet_balance', r.wallet_balance));
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verifiers (read-only)
-- ---------------------------------------------------------------------------
-- Recomputes the chain. p_last limits the check to the most recent rows (the first checked row is
-- trusted for its prev_hash, then every later row must link to it and hash correctly).
CREATE OR REPLACE FUNCTION public.verify_ledger_chain(p_last integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_prev text := NULL; v_n bigint := 0; v_from bigint := 0;
BEGIN
  IF p_last IS NOT NULL THEN
    SELECT coalesce(min(id), 0) INTO v_from FROM (SELECT id FROM public.ledger_audit ORDER BY id DESC LIMIT p_last) t;
  END IF;
  FOR r IN SELECT * FROM public.ledger_audit WHERE id >= v_from ORDER BY id LOOP
    IF v_prev IS NULL THEN
      IF v_from = 0 AND r.prev_hash <> repeat('0', 64) THEN
        RETURN jsonb_build_object('ok', false, 'bad_id', r.id, 'reason', 'bad_genesis', 'checked', v_n);
      END IF;
    ELSIF r.prev_hash <> v_prev THEN
      RETURN jsonb_build_object('ok', false, 'bad_id', r.id, 'reason', 'broken_link', 'checked', v_n);
    END IF;
    IF r.hash <> public.ledger_row_hash(r.prev_hash, r.id, r.at, r.table_name, r.op, r.row_id, r.user_id, r.before, r.after) THEN
      RETURN jsonb_build_object('ok', false, 'bad_id', r.id, 'reason', 'bad_hash', 'checked', v_n);
    END IF;
    v_prev := r.hash; v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'checked', v_n);
END $$;

-- Every wallet balance must equal the last balance written to the audit chain.
CREATE OR REPLACE FUNCTION public.verify_wallet_balances()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last_audit AS (
    SELECT DISTINCT ON (row_id) row_id, (after->>'wallet_balance')::numeric AS bal
      FROM public.ledger_audit WHERE table_name = 'profiles' ORDER BY row_id, id DESC),
  bad AS (
    SELECT p.id, p.wallet_balance, l.bal FROM public.profiles p
      LEFT JOIN last_audit l ON l.row_id = p.id::text
     WHERE l.bal IS DISTINCT FROM p.wallet_balance)
  SELECT jsonb_build_object('ok', NOT EXISTS (SELECT 1 FROM bad), 'mismatches',
    coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', id, 'balance', wallet_balance, 'audited', bal)) FROM (SELECT * FROM bad LIMIT 20) b), '[]'::jsonb))
$$;

REVOKE ALL ON FUNCTION public.ledger_append(text, text, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_audit_capture()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_ledger_chain(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_wallet_balances()     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_ledger_chain(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_wallet_balances()     TO service_role;
