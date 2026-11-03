import { createFileRoute } from "@tanstack/react-router";
import { constantTimeEqual, MIN_SECRET_LENGTH } from "@/lib/mpesa-security.server";
import { defaultDeps, reconcileStuckDeposits } from "@/lib/reconcile.server";
import { drainOpsOutbox, enqueueOpsEvent } from "@/lib/ops-alerts.server";
import { verifyLedger } from "@/lib/ledger.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Scheduled reconcile of stuck pending deposits. Call every minute (pg_cron + pg_net):
//   POST /api/public/reconcile-deposits   header: x-cron-secret: <RECONCILE_CRON_SECRET>
// Fails closed when the secret is unset or too short. At most 20 rows per run.
export const Route = createFileRoute("/api/public/reconcile-deposits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["RECONCILE_CRON_SECRET"] ?? "";
        if (expected.length < MIN_SECRET_LENGTH) {
          return Response.json({ error: "Reconcile not configured" }, { status: 503 });
        }
        if (!constantTimeEqual(request.headers.get("x-cron-secret") ?? "", expected)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        try {
          const summary = await reconcileStuckDeposits(defaultDeps());
          if (summary.held_for_review > 0 || summary.errors > 0) {
            await enqueueOpsEvent("reconcile_attention", summary, `reconcile:${new Date().toISOString().slice(0, 16)}`);
          }
          // Stuck-withdrawal scan (once per withdrawal per day) and alert delivery ride on the same cron.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseAdmin.rpc as any)("enqueue_stuck_withdrawals", { p_minutes: 30 });
          // Audit-trail check: a broken chain or a wallet that differs from its audited balance alerts once an hour.
          try {
            const check = await verifyLedger();
            if (check.chain.ok !== true || check.balances.ok !== true) {
              await enqueueOpsEvent("ledger_integrity_failed", check, `ledger_integrity:${new Date().toISOString().slice(0, 13)}`);
            }
          } catch (e) {
            console.error("[reconcile] ledger verify failed", e);
          }
          const alerts = await drainOpsOutbox();
          return Response.json({ ok: true, ...summary, alerts, ran_at: new Date().toISOString() });
        } catch (e) {
          console.error("[reconcile] run failed", e);
          return Response.json({ error: "Reconcile failed" }, { status: 500 });
        }
      },
    },
  },
});
