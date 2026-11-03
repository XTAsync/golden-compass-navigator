-- TESTED on a scratch copy of the schema (golden-compass-test), NOT yet applied to production.
-- Verified there: a normal user can no longer change wallet_balance or self-approve KYC, cannot
-- insert transactions, can still submit KYC (not_started -> pending) and edit their name; an admin
-- can approve KYC but still cannot touch wallet_balance; server-side credit_wallet still works.
-- Closes client-side tampering with money / identity columns.
--
-- Problem: policy "Users can update own profile" (USING only, no column limits) lets any
-- signed-in user run supabase.from('profiles').update({ wallet_balance: ..., kyc_status: 'approved' })
-- from the browser with the public key. Also "Users can insert own transactions" lets a user
-- forge transaction rows (e.g. a 'pending' withdrawal that no server flow created).
--
-- Design: keep the existing client flows working (users set their own kyc_status to 'pending';
-- admins decide KYC) by guarding columns in a trigger instead of revoking UPDATE outright.

CREATE OR REPLACE FUNCTION public.guard_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Trusted callers: SECURITY DEFINER RPCs (run as the function owner) and the service role.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id is immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.wallet_balance IS DISTINCT FROM OLD.wallet_balance THEN
    RAISE EXCEPTION 'wallet_balance cannot be modified directly' USING ERRCODE = '42501';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'is_active cannot be modified directly' USING ERRCODE = '42501';
  END IF;

  IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status THEN
    IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'compliance') THEN
      NULL; -- reviewers may decide KYC
    ELSIF auth.uid() = OLD.id
          AND NEW.kyc_status = 'pending'
          AND OLD.kyc_status IN ('not_started', 'rejected') THEN
      NULL; -- a user may only submit (or resubmit) their own KYC
    ELSE
      RAISE EXCEPTION 'kyc_status cannot be changed to %', NEW.kyc_status USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_guard_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_sensitive_columns();

-- Pin the existing self-update policy so the row can't be re-assigned to another user.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Reviewers update other users' KYC status from the admin screen; no policy allowed that before.
DROP POLICY IF EXISTS "Reviewers can update profiles" ON public.profiles;
CREATE POLICY "Reviewers can update profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'compliance'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'compliance'));

-- Reviewers also need to READ other users' profiles: Postgres only lets UPDATE touch rows the
-- caller can SELECT, so without this the admin KYC screen silently updated 0 rows (and could not
-- show user names). Found on the test DB.
DROP POLICY IF EXISTS "Reviewers can view profiles" ON public.profiles;
CREATE POLICY "Reviewers can view profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'compliance'));

-- No client code inserts transactions directly (verified by search of src/); all rows are created
-- by server routes with the service role. Remove the forgery path.
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;

-- The server routes write 'processing' (withdraw-approve) and 'cancelled' (mpesa-callback), but the
-- original CHECK only allowed pending|confirmed|failed, so those writes failed silently
-- (confirmed on the test DB). Allow the statuses the code actually uses.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending','processing','confirmed','failed','cancelled'));

-- Notification titles keyed on 'completed', a status that never exists ('confirmed' is used).
CREATE OR REPLACE FUNCTION public.notify_transaction_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT') OR (OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.notifications (user_id, type, title, body, metadata)
    VALUES (
      NEW.user_id,
      'transaction_' || COALESCE(NEW.status, 'update'),
      CASE NEW.status
        WHEN 'pending' THEN '⏳ Transaction pending'
        WHEN 'processing' THEN '⏳ Transaction processing'
        WHEN 'confirmed' THEN '✅ Transaction completed'
        WHEN 'failed' THEN '❌ Transaction failed'
        WHEN 'cancelled' THEN '⚠️ Transaction cancelled'
        ELSE 'Transaction update'
      END,
      'Your ' || COALESCE(NEW.type, 'transaction') || ' of KES ' || NEW.amount::text || ' is ' || COALESCE(NEW.status, 'updated'),
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type)
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_transaction_change() FROM PUBLIC, anon, authenticated;
