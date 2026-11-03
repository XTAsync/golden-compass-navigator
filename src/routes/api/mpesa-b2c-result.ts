import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/auth.server";
import { verifySafaricomOrigin } from "@/lib/mpesa-security.server";
import { completeWithdrawal, failWithdrawal } from "@/lib/ledger.server";

// Public B2C result callback. Safaricom POSTs the payout outcome here (authenticated by the
// secret in the URL). Body: { Result: { ResultCode, ResultDesc, ConversationID,
// OriginatorConversationID, ResultParameters?, ReferenceData? } }
//
// Settlement is atomic and idempotent: complete_withdrawal / fail_withdrawal only act on a
// withdrawal that is still 'processing', and the refund happens exactly once.
export const Route = createFileRoute("/api/mpesa-b2c-result")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifySafaricomOrigin(request)) {
          return new Response("Forbidden", { status: 403 });
        }

        type B2CResult = {
          ResultCode?: number;
          ResultDesc?: string;
          ConversationID?: string;
          OriginatorConversationID?: string;
          ResultParameters?: { ResultParameter?: Array<{ Key: string; Value?: string | number }> };
        };
        let result: B2CResult | undefined;
        try {
          const payload = (await request.json()) as { Result?: B2CResult };
          result = payload?.Result;
        } catch {
          return ack();
        }
        if (!result) return ack();

        try {
          // Match by Conversation ID (saved on tx.mpesa_checkout_id) or by our OriginatorConversationID.
          let txId: string | null = null;
          if (result.ConversationID) {
            const { data } = await supabaseAdmin
              .from("transactions")
              .select("id")
              .eq("mpesa_checkout_id", result.ConversationID)
              .eq("type", "withdrawal")
              .maybeSingle();
            txId = data?.id ?? null;
          }
          if (!txId && result.OriginatorConversationID) {
            const m = result.OriginatorConversationID.match(/^GC-WD-([0-9a-fA-F-]{36})$/);
            if (m) {
              const { data } = await supabaseAdmin
                .from("transactions")
                .select("id")
                .eq("id", m[1])
                .eq("type", "withdrawal")
                .maybeSingle();
              txId = data?.id ?? null;
            }
          }
          if (!txId) return ack();

          if (result.ResultCode === 0) {
            const items = result.ResultParameters?.ResultParameter ?? [];
            const receipt = items.find((i) => i.Key === "TransactionReceipt")?.Value;
            await completeWithdrawal(txId, receipt == null ? null : String(receipt));
          } else {
            await failWithdrawal(txId, `B2C failed: ${result.ResultDesc ?? "unknown"}`, [
              "processing",
            ]);
          }
          return ack();
        } catch (e) {
          console.error("[mpesa-b2c-result] settlement failed", {
            error: e,
            conv: result.ConversationID,
          });
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
