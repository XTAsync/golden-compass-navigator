# Independent PostgreSQL migration (phase 1)

## What this adds
- A fresh-install PostgreSQL baseline derived from the repository's 13 Supabase SQL migrations.
- A standalone `app_users` identity table, hashed session-token storage, and hashed password-reset-token storage.
- Existing application tables and seed data, with Supabase-only RLS policies, auth triggers, realtime publication statements, and Supabase role grants removed.
- Hardened wallet mutation functions and a wallet journal table.
- `.env.example` for the future standalone backend.

## Important limits
This commit is a **schema foundation, not a completed application cutover**. The application still imports Supabase clients in its auth middleware, database access, server libraries, and routes. Do not remove the Supabase dependency or switch production traffic to this schema yet. The next phase must migrate the query layer and implement the corresponding signup/login/session endpoints, then update each route and frontend auth flow.

This SQL is intended for a **new, empty PostgreSQL database only**. It does not copy existing Supabase data, users, password hashes, financial balances, KYC records, or transaction history. Existing users will need a planned identity migration (typically password reset) and all existing financial records need a reconciled, backed-up data export before any production cutover. Do not run this against a database that already contains these tables.

## Apply to a disposable development database
1. Create a new PostgreSQL database.
2. Set `DATABASE_URL` to its connection string in your local, untracked environment file.
3. Inspect the SQL and apply it with your normal PostgreSQL migration tool or `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_standalone_baseline.sql`.
4. Verify all tables, indexes, triggers, and functions exist before wiring application code.

The migration removes Supabase RLS policies because `auth.uid()` and the Supabase roles do not exist in standalone PostgreSQL. **That does not mean authorization can be omitted.** The API must scope every user-owned query by the authenticated session's user ID and check admin/compliance roles server-side. Use a dedicated, non-superuser runtime DB role; do not connect from the browser; do not give the application DB role ownership of the database. Before production, add explicit table/function grants and test authorization across every route.

## Wallet safety
The baseline rejects zero/negative wallet mutations, performs each balance update atomically, and records a journal row in the same database transaction. This does not by itself make M-Pesa callbacks idempotent: the callback handler still needs to lock/validate the matching transaction and ensure a payment can credit a wallet only once. That is part of the backend migration phase.

## Secrets
The repository's current main branch tracks a `.env` file. This branch removes it from the working tree and ignores local environment files, but deleting a file does not remove it from Git history. Review any values previously committed and rotate any private credentials that may have been exposed. Never commit service credentials, database passwords, session secrets, or M-Pesa secrets. Keep only non-secret variable names/placeholders in `.env.example`.

## Runtime connection module

`src/lib/db.server.ts` now provides a lazy PostgreSQL.js connection pool via `getDb()`. It reads `DATABASE_URL` only on the server and deliberately does not connect until called. Existing Supabase-dependent routes are not switched to this pool yet; keep Supabase configured until each data-access path has been migrated and tested.
