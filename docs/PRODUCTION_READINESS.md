# Golden Compass — production readiness audit and resumable checklist

Date: 2026-10-25. Repo: XTAsync/thegolden-compass @ 534c988. Method: static review only
(npm registry was unreachable from the audit sandbox, so nothing was built, linted, or run).

## Blockers to "production ready" (fix in this order)

### P0 — money can be created or stolen
1. **Users can edit their own wallet balance and KYC status from the browser.**
   `profiles.wallet_balance` lives in `profiles`; the UPDATE policy has no column limits
   (migration 20260416170739). Any signed-in user can set `wallet_balance` or `kyc_status='approved'`
   with the public key. The app itself writes `kyc_status` from the client (`routes/kyc.tsx`,
   `routes/admin.kyc.tsx`), so the fix must preserve those flows.
   Draft fix: `supabase/migrations/20261025090000_lock_profile_sensitive_columns.sql` (guard trigger).
2. **Forged transactions.** Policy "Users can insert own transactions" lets a user insert a
   `pending` withdrawal that no server flow created. `withdraw-approve` pays out `tx.amount`
   to `payout_phone` for any pending withdrawal, with no check that units were reserved.
   Draft fix removes the policy (no client code inserts transactions). Also add a server-side
   marker/check in `withdraw-approve` (e.g. require a reservation row or `reserved_at`).
3. **M-Pesa callback fails open.** `verifySafaricomOrigin` returns true whenever `MPESA_ENV`
   is unset or `sandbox` (default is sandbox), trusts client-controlled `x-forwarded-for` /
   `x-real-ip`, and its "CIDR" check is a string-prefix match on `196.201.214`.
   Safaricom does not sign callbacks; use a long random secret in the callback URL path or
   query, compare in constant time, keep an IP allowlist only as a second layer, and confirm
   the amount in `CallbackMetadata` equals `transactions.amount`.
4. **Callback can lose or double-credit money.** `mpesa-callback.ts` marks the transaction
   `confirmed` before crediting; if `credit_wallet` fails, the retry is skipped as "idempotent"
   and the user is never credited. Two concurrent callbacks can both pass the status check and
   credit twice. Fix: one atomic RPC that does
   `UPDATE transactions SET status='confirmed' WHERE id=$1 AND status='pending' RETURNING ...`
   and the credit in the same transaction (plus a UNIQUE index on `mpesa_reference`).
5. **Withdrawals are not atomic.** `withdraw-request.ts` reads the holding, inserts the
   transaction, then separately writes the reduced balance using the stale value read earlier
   (lost update / double-spend with two parallel requests, and a crash between steps leaves a
   pending payout with no units reserved). `withdraw-approve.ts` checks `status === 'pending'`
   then updates without a conditional, so two admins (or two clicks) can fire two B2C payouts;
   `refundUnits` has the same race (double refund). A network exception after setting
   `processing` leaves the transaction stuck with no refund. Fix: move reserve / approve /
   refund into SECURITY DEFINER RPCs with row locks (`SELECT ... FOR UPDATE`) and conditional
   status transitions, and write an audit row in the same transaction.

### P1 — before real users
6. Rate limiter is an in-memory `Map` (resets per isolate, not shared across Cloudflare
   workers) — use a DB/KV-backed limiter for money endpoints, and key by IP as well as user.
7. Money is `numeric`/JS `Number` with `toFixed`/`Math.floor`; the roadmap's integer-ledger
   checkpoint (#2) is still open. Add reconciliation queries before switching reads.
8. Audit log is written from the browser in `admin.kyc.tsx` (`audit_logs.insert`) — an admin
   client can omit or forge entries. Write audit rows server-side/in RPCs; roadmap says
   "immutable audit chain" is still open.
9. `.github/workflows/npm-publish-github-packages.yml` is a package-publish workflow in a
   private app repo; remove it unless intended.
10. Leaked-password protection is disabled on the Supabase project (advisor warning).
11. Only one test file exists (`features/settings/capabilities.test.ts`) and `package.json`
    has no `test`, `typecheck` scripts. Add Vitest + tests for every money path above.

### New findings from reading the migrations (verify on the test DB)
14. **Status values the code writes are rejected by the DB.** `transactions.status` CHECK only
    allows `pending|confirmed|failed`, but `withdraw-approve.ts` writes `processing` and
    `mpesa-callback.ts` writes `cancelled`. The Supabase client returns an error instead of
    throwing and the code ignores it, so the "processing" guard that is meant to stop double
    payouts silently does nothing and cancelled deposits stay `pending`. (Unless the live DB was
    altered outside these migrations; check.)
15. **A migration forces `broker_mode` to `"live"`** (20260804071814) after an earlier one seeded
    `"mock"`. Confirm that is intended before launch; live trading must stay gated by compliance.
16. `notify_transaction_change` titles on `'completed'`, a status that does not exist (`confirmed`
    is used), so confirmed transactions get a generic title.
17. `app_config` is readable by every signed-in user (`USING (true)`); fine for flags, but never
    put secrets there.

### P2 — hygiene
12. `.env` is tracked in git; it holds only publishable keys (low risk) but move to
    `.env.example` and gitignore the real file.
13. Roadmap checkpoints 1–10 are all unchecked; M-Pesa go-live remains gated on Mike's
    compliance sign-off and broker credentials (owner actions).

## Environment limits hit during the audit
- npm registry (registry.npmjs.org) is blocked for the session: no install/build/test/typecheck.
- `@lovable.dev/mcp-js` and `@cloudflare/vite-plugin` returned 403 from the egress proxy.
- Pushing to XTAsync/thegolden-compass is refused (Claude GitHub App not installed for that
  account), so changes stay local until that is fixed.
- The Supabase project found, `golden-compass-demo`, contains only a `gc_scores` demo table;
  the real schema (profiles, transactions, ...) is not in any ACTIVE project visible here
  (`G-c` and `Trading sys` are INACTIVE), so migrations could not be tested against a live DB.

## Resume checklist (tick as done; continue from the first unchecked item)
- [x] Clone repo, read roadmap/AGENTS.md, review migrations and money routes
- [x] Draft migration locking profile columns + removing transaction INSERT policy
- [x] Working install (use `npm install --legacy-peer-deps --no-package-lock`; `package-lock.json` is stale, project really uses `bun.lockb`). Baseline: tsc clean, `vite build` OK, vitest 5/5 (settings only), eslint 1442 problems (1419 auto-fixable prettier, rest e.g. `no-explicit-any`)
- [x] Test Supabase project created: `golden-compass-test` (ref `nlykuyjxamvhjwikqdmz`, eu-central-1). Real Lovable project `jmbemmdnepzjimaglvgi` is not reachable from this account.
- [x] All 13 repo migrations applied to the test project `golden-compass-test`. Notes: the Supabase tool cancels any migration containing DROP statements, so 07b was pasted by the user in the SQL editor; in 09 the two `DROP POLICY IF EXISTS` lines on `aml_flags` were omitted because those policies did not exist (no-ops).
- [x] Reproduced on the test DB as a plain signed-in user: (1) set own `wallet_balance=999999` and `kyc_status='approved'`; (2) inserted a forged pending withdrawal of 50,000; (3) `transactions.status='processing'` is rejected by the CHECK constraint.
- [x] Applied `20261025090000_lock_profile_sensitive_columns.sql` to the test DB and re-ran the attacks: wallet edit, self-approve KYC (from not_started and from pending) and forged transaction insert are all blocked; user KYC submit and rename work; admin KYC approval works; admin cannot set wallet_balance; server `credit_wallet` works; `processing` status accepted.
- [x] New finding fixed in the same migration: admins/compliance had no SELECT policy on `profiles`, so the admin KYC screen updated 0 rows and could not show names.
- [x] Live (Lovable Cloud) DB checked by the owner on 2026-10-25: 0 withdrawals, 0 profiles with balance>0 or approved KYC, 8 users. No sign the hole was exploited.
- [ ] Owner pastes the migration into Lovable's chat to apply it to the live DB (after review), then re-runs the three attacks against live.
- [x] P0-3/4: callback secret (fail closed) + amount/receipt check + atomic `confirm_deposit` (migration `20261025120000_atomic_money_flows.sql`, code in `mpesa-callback.ts`, `mpesa-security.server.ts`). Tested on the scratch DB: wallet credited once (250 -> 1250), retries return `already_processed`, wrong amount/missing or reused receipt held for review with an AML flag, user-cancel handled, browser roles cannot call the functions. 9 unit tests for the secret check.
- [x] P0-5: atomic `request_withdrawal`, `approve_withdrawal_start`, `fail_withdrawal`, `complete_withdrawal`. Tested on the scratch DB (19 scripted checks): fee/units reserved correctly, over-ask and locked pools refused, non-admin cannot approve, double approve refused, refund returns GROSS once (old code refunded NET and lost the exit fee), no double refund, completed payout cannot be failed.
- [x] P0-2: payouts bound to a reservation (`reserved_at`); a forged pending withdrawal returns `not_reserved` and can never be paid or refunded.
- [ ] TRUE concurrency test: the Supabase tool runs calls one after another, so simultaneous requests were not exercised. Correctness relies on Postgres `SELECT ... FOR UPDATE`; add an integration test that opens two real connections (needs the DB connection string) before go-live.
- [ ] Deposit race: the STK route stores `mpesa_checkout_id` AFTER the push; a very fast callback could arrive first and find no transaction (`not_found`). Store the id before relying on the callback, or add a reconciliation job using STK Query.
- [ ] Reconciliation job: list `processing` withdrawals and `pending` deposits older than N minutes (needs M-Pesa Transaction Status / STK Query) and alert; the unknown-outcome path in `withdraw-approve.ts` leaves rows in `processing` on purpose.
- [ ] Set `MPESA_CALLBACK_SECRET` (random, >= 24 chars) in the host env BEFORE enabling live M-Pesa; without it all callbacks are rejected (unless `MPESA_ENV=sandbox`).
- [ ] Net payout is floored to whole KES (`Math.floor`), so up to KES 0.99 per withdrawal is not paid out; decide whether to round the fee up instead.
- [ ] P1: durable rate limiting, server-side audit log, remove stray workflow, `.env.example`
- [ ] Add Vitest + `test`/`typecheck` scripts; cover money paths and RLS (pgTAP or SQL tests)
- [ ] Work through roadmap checkpoints 1–10
- [ ] Final verification pass (lint, typecheck, tests, build, Supabase advisors)
