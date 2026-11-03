import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/auth.server";
import { verifySafaricomOrigin } from "@/lib/mpesa-security.server";
import { recordB2cTimeout } from "@/lib/ledger.server";

// Public B2C QUEUE TIMEOUT callback (review decision T4). Safaricom calls this when a payout
// request waited too long in its queue. The payout may STILL succeed later, so this route only
// records the notice. It never fails or refunds the withdrawal: only the result callback (a real
// outcome) or an admin reconciling against the M-Pesa statement may do that.
export const Route = createFileRoute("/api/mpesa-b2c-timeout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifySafaricomOrigin(request)) return new Response("Forbidden", { status: 403 });

        let result:
          | { ResultDesc?: string; ConversationID?: string; OriginatorConversationID?: string }
          | undefined;
        try {
          result = ((await request.json()) as { Result?: typeof result })?.Result;
        } catch {
          return ack();
        }
        if (!result) return ack();

        try {
          let txId: string | null = null;
          const m = result.OriginatorConversationID?.match(/^GC-WD-([0-9a-fA-F-]{36})$/);
          if (m) txId = m[1];
          if (!txId && result.ConversationID) {
            const { data } = await supabaseAdmin
              .from("transactions")
              .select("id")
              .eq("mpesa_checkout_id", result.ConversationID)
              .eq("type", "withdrawal")
              .maybeSingle();
            txId = data?.id ?? null;
          }
          if (txId) await recordB2cTimeout(txId, result.ResultDesc ?? "queue timeout");
          return ack();
        } catch (e) {
          console.error("[mpesa-b2c-timeout] could not record", { error: e });
          return json({ ResultCode: 1, ResultDesc: "Temporary failure" }, 500);
        }
      },
      GET: async () => ack(),
    },
  },
});

function ack() {
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}
