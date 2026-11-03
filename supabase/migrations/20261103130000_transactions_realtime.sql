-- PR3 / E3: let the wallet deposit sheet hear about its own transaction changing (RLS still applies:
-- a user only receives rows they may SELECT). Idempotent. Polling stays as the fallback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='transactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  END IF;
END $$;
