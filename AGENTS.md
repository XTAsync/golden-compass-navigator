# Architecture rules

- Preserve the existing TanStack Start app and migrate incrementally by ordered checkpoints; this avoids breaking working investing and authentication flows.
- App-internal privileged operations use TanStack server functions and external callbacks use authenticated/verified server routes; the hosted runtime does not use new Supabase Edge Functions.
- Product requirements live in project memory, while pending implementation checkpoints live in roadmap.md; this separates enduring safeguards from work tracking.
- Migrate money storage additively with backfills and explicit reconciliation before switching reads; existing balances and pool holdings must never be silently discarded.