import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/auth.server";
import { verifySafaricomOrigin } from "@/lib/mpesa-security.server";
import { confirmDeposit, queueUnmatchedCallback } from "@/lib/ledger.server";
import { enqueueOpsEvent, rejectedCallbackKey } from "@/lib/ops-alerts.server";

// Public callback Safaricom POSTs to after an STK push. Authenticated by the secret in the URL
// (see mpesa-security.server.ts). Body shape:
// { Body: { stkCallback: { ResultCode, CheckoutRequestID, CallbackMetadata? } } }
//
// All settlement happens inside ONE database function (confirm_deposit): it locks the
// transaction, checks the paid amount and receipt, and credits the wallet exactly once.
export const Route = createFileRoute("/api/mpesa-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifySafaricomOrigin(request)) {
          // At most one alert per hour, so a hostile caller cannot flood the webhook. Not awaited.
          void enqueueOpsEvent("callback_rejected", {}, rejectedCallbackKey());
          return new Response("Forbidden", { status: 403 });
        }

        let cb: StkCallback | undefined;
        try {
          const payload = (await request.json()) as { Body?: { stkCallback?: StkCallback } };
          cb = payload?.Body?.stkCallback;
        } catch {
          return ack(); // malformed body: nothing to settle
        }
        if (!cb?.CheckoutRequestID) return ack();

        const items = cb.CallbackMetadata?.Item ?? [];
        const receiptRaw = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value;
        const amountRaw = items.find((i) => i.Name === "Amount")?.Value;
        const receipt = receiptRaw == null ? null : String(receiptRaw);
        const paid =
          amountRaw == null || Number.isNaN(Number(amountRaw)) ? null : Number(amountRaw);

        try {
          const settleArgs = {
            checkoutId: cb.CheckoutRequestID,
            resultCode: typeof cb.ResultCode === "number" ? cb.ResultCode : null,
            receipt,
            paidAmount: paid,
          };
          let res = await confirmDeposit(settleArgs);
          // A very fast callback can beat the STK route saving the checkout id. Park it; the STK
          // route settles it as soon as the id is saved (or this call settles it if it just was).
          if (res.result === "not_found") res = await queueUnmatchedCallback(settleArgs);

          if (res.result === "confirmed") {
            // Courtesy notification only; the money is already settled and must not depend on this.
            try {
              await supabaseAdmin.from("notifications").insert({
                user_id: String(res.user_id),
                type: "deposit",
                title: "Wallet credited",
                body: `KES ${Number(res.amount).toLocaleString()} added to your wallet.`,
              });
            } catch (e) {
              console.error("[mpesa-callback] notification failed", e);
            }
          } else if (
            res.result === "amount_mismatch" ||
            res.result === "missing_receipt" ||
            res.result === "duplicate_receipt"
          ) {
            console.error("[mpesa-callback] deposit held for review", {
              checkoutId: cb.CheckoutRequestID,
              result: res.result,
            });
          }
          return ack();
        } catch (e) {
          // Database/infrastructure error: money state is unknown. Return 500 (not 200) so this is
          // visible and retryable, and log loudly for the reconciliation job.
          console.error("[mpesa-callback] settlement failed", {
            checkoutId: cb.CheckoutRequestID,
            error: e,
          });
          return json({ ResultCode: 1, ResultDesc: "Temporary failure" }, 500);
        }
      },
      // Safaricom may probe with GET
      GET: async () => ack(),
    },
  },
});

type StkCallback = {
  ResultCode?: number;
  ResultDesc?: string;
  CheckoutRequestID?: string;
  CallbackMetadata?: { Item?: Array<{ Name: string; Value?: string | number }> };
};

function ack() {
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}
