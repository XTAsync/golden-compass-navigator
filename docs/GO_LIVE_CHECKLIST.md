# Go-live checklist

Live M-Pesa stays OFF until every box below is ticked. PR1 alone is sandbox-only: until PR2 there is
no pause switch and no ops alerts, so PR1 must never run with live M-Pesa enabled.

## 1. Code gates
- [ ] PR1 merged and verified on the Supabase test project (golden-compass-test)
- [ ] PR2 merged (pause switch and daily caps, ops alerts, whole-shilling fee rounding, pool investing, wallet withdrawal, money-config route, request ids)
- [ ] PR3 merged (hash-chained ledger audit, realtime deposit confirmation)
- [ ] Supabase project switch PR merged after PR1 is verified
- [ ] `npm run typecheck`, `npm test`, `npm run test:sql` and `npm run test:concurrency` pass (the last two need a scratch database, never production)

## 2. Secrets and environment (set on Production only after review)
- [ ] `MPESA_CALLBACK_SECRET` set, at least 24 characters
- [ ] `ALERTS_CRON_SECRET` set, at least 24 characters, different from every other secret (price-alert cron; header `x-cron-secret`)
- [ ] `RECONCILE_CRON_SECRET` set, at least 24 characters (reconcile cron; header `x-cron-secret`)
- [ ] `OPS_WEBHOOK_URL` set (Slack or Discord webhook); send a test pause-flag flip and see the alert arrive
- [ ] `MPESA_SANDBOX_ENABLED` is NOT set on Production
- [ ] Safaricom B2C result URL and queue-timeout URL registered: `/api/mpesa-b2c-result` and `/api/mpesa-b2c-timeout`

## 3. Scheduler
- [ ] pg_cron + pg_net call `POST /api/public/reconcile-deposits` every minute with the reconcile secret
- [ ] pg_cron + pg_net call `POST /api/public/check-price-alerts` with the alerts secret
- [ ] Cadence verified by looking at two consecutive runs in the logs
- [ ] Realtime is enabled for `transactions` (migration 20261103130000); the deposit sheet shows success within seconds of the callback, and still works with Realtime off (12 s poll)
- [ ] Ledger audit check: `select verify_ledger_chain(); select verify_wallet_balances();` both return ok true; the reconcile cron alerts on `ledger_integrity_failed`

## 4. Sandbox proof (T6, needs Safaricom sandbox credentials)
- [ ] One real sandbox STK push and callback captured as a fixture
- [ ] One real sandbox B2C payout, result callback and queue-timeout captured as fixtures
- [ ] A stuck deposit (callback withheld) is picked up by reconcile within 15 minutes

## 5. Owner values (decided by Indra, to confirm with Mike before go-live)
- [ ] **Top-up lock rule (DR2):** one unlock date for the whole holding, counted from the first investment; a top-up does not restart it. Accepted risk: a large top-up just before the unlock date can be withdrawn at once. Upgrade when Mike rejects it or the ledger audit shows in-and-out investing: per-investment unlock dates.
- [ ] **Fresh wallet deposits (DR3):** the whole wallet balance can be withdrawn at once with no waiting period, subject to admin approval, caps and the pause switch. Accepted risk: deposit then withdraw within minutes is possible (pass-through of funds). Upgrade when Mike or Safaricom raises it, or the audit shows such patterns: withdrawable = balance minus deposits in the last 24 hours.
- [ ] **Wallet withdrawal fee (DR4):** none at launch (the business absorbs the Safaricom payout cost).
- [ ] **Payout promise (U3):** the app says "Usually within 24 hours". Confirm operations can meet it.
- [ ] **Pool holding periods, exit fees and minimums** reviewed by Mike
- [ ] Real values set in `app_config` (placeholders today): `withdraw_min_kes` (100), `withdraw_cap_user_daily` (100000), `withdraw_cap_global_daily` (1000000), `wallet_withdraw_fee_percent` (0), and the per-user limits table

## 6. Operations
- [ ] At least two admins exist (an admin cannot approve their own withdrawal)
- [ ] Someone owns the "Needs review" list (deposits Safaricom says were paid but have no receipt) and checks it daily
- [ ] Someone owns stuck withdrawals (status processing for more than 30 minutes) and reconciles them against the M-Pesa statement before any refund
- [ ] Pause switch tested once end to end: set `withdrawals_paused` to true in `app_config`, see the sheet show the paused message, see the alert arrive, set it back
- [ ] Screens checked by a person on a real phone at 360 px width (checked so far only in a desktop browser at 360x640 with fake data, not against the real backend)
