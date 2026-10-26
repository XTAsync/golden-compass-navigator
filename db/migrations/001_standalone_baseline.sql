-- Golden Compass standalone PostgreSQL baseline.
-- Fresh-install schema derived from the 13 existing Supabase SQL migrations.
-- This is NOT a data migration; apply only to a new/empty database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Standalone identity store. Hash passwords with Argon2id in the application.
CREATE TABLE public.app_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL,
 password_hash text NOT NULL,
 full_name text NOT NULL DEFAULT '',
 email_verified_at timestamptz,
 is_disabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_users_email_lower_uniq ON public.app_users(lower(email));

CREATE TABLE public.auth_sessions (
 token_hash char(64) PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 user_agent text,
 ip_address inet,
 revoked_at timestamptz
);
CREATE INDEX auth_sessions_user_idx ON public.auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry_idx ON public.auth_sessions(expires_at);

CREATE TABLE public.password_reset_tokens (
 token_hash char(64) PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 used_at timestamptz
);
CREATE INDEX password_reset_tokens_user_idx ON public.password_reset_tokens(user_id);
CREATE INDEX password_reset_tokens_expiry_idx ON public.password_reset_tokens(expires_at);

CREATE TABLE public.wallet_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
 entry_type text NOT NULL CHECK (entry_type IN ('credit','debit')),
 amount numeric(18,2) NOT NULL CHECK (amount > 0),
 balance_after numeric(18,2) NOT NULL CHECK (balance_after >= 0),
 source text NOT NULL,
 reference_id text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_ledger_user_created_idx ON public.wallet_ledger(user_id, created_at DESC);


-- Source migration: supabase/migrations/20260416170739_929ae8e0-f1f6-4ee1-8cbe-546b5af56bb1.sql
CREATE TYPE public.app_role AS ENUM ('investor', 'admin', 'compliance', 'auditor');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT UNIQUE,
  kyc_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (kyc_status IN ('not_started','pending','approved','rejected')),
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE TABLE public.investment_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  pool_type TEXT,
  current_nav DECIMAL(12,4) DEFAULT 100.0000,
  total_value DECIMAL(18,2) DEFAULT 0,
  total_units DECIMAL(18,4) DEFAULT 0,
  min_investment DECIMAL(12,2) DEFAULT 1000,
  exit_fee_percent DECIMAL(5,2) DEFAULT 0,
  holding_period_days INT DEFAULT 30,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.user_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  pool_id UUID NOT NULL REFERENCES public.investment_pools(id),
  units_owned DECIMAL(18,4) DEFAULT 0,
  invested_amount DECIMAL(18,2) DEFAULT 0,
  current_value DECIMAL(18,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, pool_id)
);

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  pool_id UUID REFERENCES public.investment_pools(id),
  type TEXT CHECK (type IN ('deposit','withdrawal')),
  amount DECIMAL(18,2) NOT NULL,
  mpesa_reference TEXT,
  mpesa_checkout_id TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','failed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE public.kyc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  national_id TEXT,
  date_of_birth DATE,
  address TEXT,
  employment_status TEXT,
  source_of_funds TEXT,
  annual_income_range TEXT,
  risk_disclosure_accepted BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES public.app_users(id),
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.pool_nav_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.investment_pools(id),
  nav_value DECIMAL(12,4) NOT NULL,
  admin_notes TEXT,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.aml_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES public.transactions(id),
  user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
  flag_reason TEXT,
  amount DECIMAL(18,2),
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_investments_updated_at
  BEFORE UPDATE ON public.user_investments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();















INSERT INTO public.investment_pools (slug, name, pool_type, current_nav, total_value, total_units, min_investment, exit_fee_percent, holding_period_days)
VALUES
  ('bahari', 'Bahari Growth', 'Growth', 101.28, 2400000, 23698, 1000, 2.0, 30),
  ('stable-harbour', 'Stable Harbour', 'Stable', 100.42, 5100000, 50798, 500, 0.0, 7),
  ('alpha-ventures', 'Alpha Ventures', 'High Risk', 124.10, 890000, 7171, 5000, 3.0, 60);


-- Source migration: supabase/migrations/20260418074755_01608c0f-f6e4-4dc5-bca5-145ffa6f0a0f.sql
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);


CREATE OR REPLACE FUNCTION public.notify_transaction_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') OR (OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.notifications (user_id, type, title, body, metadata)
    VALUES (
      NEW.user_id,
      'transaction_' || COALESCE(NEW.status, 'update'),
      CASE NEW.status
        WHEN 'pending' THEN '⏳ Transaction pending'
        WHEN 'completed' THEN '✅ Transaction completed'
        WHEN 'failed' THEN '❌ Transaction failed'
        ELSE 'Transaction update'
      END,
      'Your ' || COALESCE(NEW.type, 'transaction') || ' of KES ' || NEW.amount::text || ' is ' || COALESCE(NEW.status, 'updated'),
      jsonb_build_object('transaction_id', NEW.id, 'amount', NEW.amount, 'type', NEW.type)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_transaction
AFTER INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.notify_transaction_change();

CREATE OR REPLACE FUNCTION public.notify_kyc_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.notifications (user_id, type, title, body, metadata)
    VALUES (
      NEW.user_id,
      'kyc_' || NEW.status,
      CASE NEW.status
        WHEN 'approved' THEN '🎉 KYC Approved'
        WHEN 'rejected' THEN '⚠️ KYC Rejected'
        WHEN 'pending' THEN '🔍 KYC Under Review'
        ELSE 'KYC Update'
      END,
      COALESCE(NEW.review_notes, 'Your verification status has been updated to ' || NEW.status),
      jsonb_build_object('kyc_id', NEW.id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_kyc
AFTER UPDATE ON public.kyc_records
FOR EACH ROW EXECUTE FUNCTION public.notify_kyc_change();

CREATE OR REPLACE FUNCTION public.notify_welcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (
    NEW.id,
    'welcome',
    '⚓ Welcome aboard, ' || COALESCE(NULLIF(NEW.full_name, ''), 'Navigator'),
    'Your Golden Compass account is ready. Complete KYC to start investing.'
  );
  RETURN NEW;
END;
$$;


-- Source migration: supabase/migrations/20260421082936_7ffbeae9-89f8-4614-b640-2e467b41e432.sql
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payout_phone text;


-- Source migration: supabase/migrations/20260421101620_1f3d8e52-9890-49ba-8ab5-bbe6b9b70165.sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wallet_balance numeric NOT NULL DEFAULT 0;


-- Source migration: supabase/migrations/20260623042204_2b6d9df4-1bfc-4b5c-8649-cae96e002ecc.sql
CREATE OR REPLACE FUNCTION public.debit_wallet(p_user_id UUID, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance NUMERIC;
BEGIN
  UPDATE profiles SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id AND wallet_balance >= p_amount
  RETURNING wallet_balance INTO new_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  RETURN new_balance;
END; $$;

CREATE OR REPLACE FUNCTION public.credit_wallet(p_user_id UUID, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance NUMERIC;
BEGIN
  UPDATE profiles SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id RETURNING wallet_balance INTO new_balance;
  RETURN new_balance;
END; $$;


-- Source migration: supabase/migrations/20260623042231_6e743f7e-05c1-4c62-90bb-71a2e05abe27.sql



-- Source migration: supabase/migrations/20260624142020_e31f2c0f-358c-4434-a182-e23bf277cc42.sql
DROP POLICY IF EXISTS "Users can update own investments" ON public.user_investments;
DROP POLICY IF EXISTS "Users can insert own investments" ON public.user_investments;

DROP POLICY IF EXISTS "Admins insert notifications" ON public.notifications;

DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;


-- Source migration: supabase/migrations/20260802053435_44343ec9-28b6-4fe5-a321-6959cbd20f46.sql
CREATE TABLE public.stock_holdings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'NSE',
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_price NUMERIC NOT NULL DEFAULT 0,
  invested_amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, exchange)
);


CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'NSE',
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  price NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','filled','failed','cancelled')),
  account_id TEXT,
  broker_order_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE INDEX idx_orders_user_created ON public.orders (user_id, created_at DESC);
CREATE INDEX idx_stock_holdings_user ON public.stock_holdings (user_id);

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stock_holdings_updated_at
  BEFORE UPDATE ON public.stock_holdings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Source migration: supabase/migrations/20260803045928_bc77f13e-cf90-4444-bf8f-a4d46b37c16e.sql
ALTER TABLE public.profiles          ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES';
ALTER TABLE public.transactions      ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES';
ALTER TABLE public.user_investments  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES';

ALTER TABLE public.kyc_records ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'national_id';
ALTER TABLE public.kyc_records ADD COLUMN IF NOT EXISTS country       text NOT NULL DEFAULT 'KE';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS enabled_markets jsonb NOT NULL DEFAULT '["NSE"]'::jsonb;

CREATE TABLE IF NOT EXISTS public.legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  version text NOT NULL,
  title text NOT NULL,
  summary text,
  is_draft boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);


CREATE TRIGGER update_legal_documents_updated_at
  BEFORE UPDATE ON public.legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.legal_documents (slug, version, title, summary, is_draft, published_at) VALUES
  ('terms',           '0.1.0-draft', 'Terms of Service',  'Draft terms of service pending Kenyan legal review.', true, now()),
  ('privacy',         '0.1.0-draft', 'Privacy Policy',    'Draft privacy policy pending Kenyan legal review.',   true, now()),
  ('risk-disclosure', '0.1.0-draft', 'Risk Disclosure',   'Draft risk disclosure pending CMA/legal review.',     true, now())
ON CONFLICT (slug, version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  document_slug text NOT NULL,
  version text NOT NULL,
  context text NOT NULL DEFAULT 'kyc',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx ON public.legal_acceptances(user_id, document_slug);

CREATE TABLE IF NOT EXISTS public.transaction_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.app_users(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'default',
  currency text NOT NULL DEFAULT 'KES',
  daily_deposit_max numeric NOT NULL DEFAULT 150000,
  monthly_deposit_max numeric NOT NULL DEFAULT 1000000,
  daily_withdrawal_max numeric NOT NULL DEFAULT 150000,
  monthly_withdrawal_max numeric NOT NULL DEFAULT 1000000,
  daily_invest_max numeric NOT NULL DEFAULT 500000,
  single_txn_max numeric NOT NULL DEFAULT 150000,
  is_active boolean NOT NULL DEFAULT true,
  notes text DEFAULT 'TBD — placeholder threshold, pending compliance sign-off.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_limits_user_uniq ON public.transaction_limits(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transaction_limits_tier_uniq ON public.transaction_limits(tier) WHERE user_id IS NULL;


CREATE TRIGGER update_transaction_limits_updated_at
  BEFORE UPDATE ON public.transaction_limits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.transaction_limits (user_id, tier, notes)
VALUES (NULL, 'default', 'TBD — placeholder thresholds for proof of concept. Replace with CMA/AML-approved caps before launch.')
ON CONFLICT DO NOTHING;

ALTER TABLE public.aml_flags ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.app_users(id);
ALTER TABLE public.aml_flags ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.aml_flags ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'medium';
ALTER TABLE public.aml_flags ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.aml_flags ADD COLUMN IF NOT EXISTS review_notes text;


DROP POLICY IF EXISTS "Admins read aml flags" ON public.aml_flags;
DROP POLICY IF EXISTS "Admins update aml flags" ON public.aml_flags;

CREATE TABLE IF NOT EXISTS public.fee_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL UNIQUE,
  commission_percent numeric NOT NULL DEFAULT 1.78,
  tax_percent numeric NOT NULL DEFAULT 5.0,
  min_commission numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  label text NOT NULL DEFAULT 'illustrative rate — TBD pending broker agreement',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TRIGGER update_fee_config_updated_at
  BEFORE UPDATE ON public.fee_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.fee_config (market, commission_percent, tax_percent, min_commission, currency) VALUES
  ('NSE',    1.78, 5.0, 100, 'KES'),
  ('NGX',    1.50, 5.0, 0,   'KES'),
  ('JSE',    1.20, 5.0, 0,   'KES'),
  ('GSE',    1.50, 5.0, 0,   'KES'),
  ('GLOBAL', 0.50, 5.0, 0,   'USD')
ON CONFLICT (market) DO NOTHING;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission    numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_withheld  numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS currency      text    NOT NULL DEFAULT 'KES';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS filled_at     timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_simulated  boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);


CREATE TRIGGER update_app_config_updated_at
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_config (key, value, description) VALUES
  ('broker_mode', '"mock"'::jsonb, 'MOCK: "mock" routes trades to the simulated broker. Set to "live" once a licensed broker integration exists.'),
  ('mock_broker', '{"fill_delay_ms":1200,"failure_rate":0.12,"volatility_pct":0.8}'::jsonb, 'MOCK: simulated broker behaviour tuning.')
ON CONFLICT (key) DO NOTHING;


-- Source migration: supabase/migrations/20260804071814_311c4477-10d0-4ced-9640-808e3eea0969.sql
INSERT INTO public.app_config (key, value)
VALUES ('broker_mode', '"live"'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;


-- Source migration: supabase/migrations/20260806164706_f5ebef5f-1408-4d93-9188-5d841f8287d7.sql
CREATE TABLE public.watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  exchange text NOT NULL DEFAULT 'NSE',
  company text,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX watchlists_user_symbol_idx ON public.watchlists (user_id, symbol, exchange);


-- Source migration: supabase/migrations/20260807071646_777052a8-a47b-4fa2-b8e5-6e71b8b6aada.sql
CREATE TABLE public.price_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'NSE',
  name TEXT,
  condition TEXT NOT NULL CHECK (condition IN ('greater','less')),
  threshold_price NUMERIC NOT NULL CHECK (threshold_price > 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  triggered_at TIMESTAMP WITH TIME ZONE
);


CREATE INDEX idx_price_alerts_active ON public.price_alerts (symbol, exchange) WHERE triggered_at IS NULL;


-- Source migration: supabase/migrations/20260808084156_0e22318b-471d-431d-b119-e4c2cf2be113.sql
CREATE TABLE public.brokerage_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  label text NOT NULL DEFAULT 'Brokerage account',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id)
);


CREATE INDEX brokerage_accounts_user_idx ON public.brokerage_accounts (user_id);

-- App-user bootstrap replaces the Supabase auth.users trigger.
CREATE OR REPLACE FUNCTION public.create_app_user_records()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 INSERT INTO public.profiles (id, full_name) VALUES (NEW.id, NEW.full_name)
 ON CONFLICT (id) DO NOTHING;
 INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'investor')
 ON CONFLICT (user_id, role) DO NOTHING;
 INSERT INTO public.notifications (user_id, type, title, body, metadata)
 VALUES (NEW.id, 'welcome', 'Welcome aboard!', 'Your Golden Compass account is ready.', '{}'::jsonb);
 RETURN NEW;
END;
$$;
CREATE TRIGGER trg_app_user_records AFTER INSERT ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.create_app_user_records();

ALTER TABLE public.transactions ADD CONSTRAINT transactions_amount_positive CHECK (amount > 0);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_wallet_balance_nonnegative CHECK (wallet_balance >= 0);
CREATE UNIQUE INDEX transactions_mpesa_checkout_id_unique ON public.transactions(mpesa_checkout_id) WHERE mpesa_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX transactions_mpesa_reference_unique ON public.transactions(mpesa_reference) WHERE mpesa_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.debit_wallet(p_user_id uuid, p_amount numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance numeric;
BEGIN
 IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero' USING ERRCODE = '22023'; END IF;
 UPDATE public.profiles SET wallet_balance = wallet_balance - p_amount
 WHERE id = p_user_id AND wallet_balance >= p_amount RETURNING wallet_balance INTO new_balance;
 IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient balance or user not found' USING ERRCODE = 'P0001'; END IF;
 INSERT INTO public.wallet_ledger(user_id, entry_type, amount, balance_after, source)
 VALUES (p_user_id, 'debit', p_amount, new_balance, 'debit_wallet');
 RETURN new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_wallet(p_user_id uuid, p_amount numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance numeric;
BEGIN
 IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero' USING ERRCODE = '22023'; END IF;
 UPDATE public.profiles SET wallet_balance = wallet_balance + p_amount
 WHERE id = p_user_id RETURNING wallet_balance INTO new_balance;
 IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0001'; END IF;
 INSERT INTO public.wallet_ledger(user_id, entry_type, amount, balance_after, source)
 VALUES (p_user_id, 'credit', p_amount, new_balance, 'credit_wallet');
 RETURN new_balance;
END;
$$;
REVOKE ALL ON FUNCTION public.debit_wallet(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_wallet(uuid, numeric) FROM PUBLIC;
COMMIT;
