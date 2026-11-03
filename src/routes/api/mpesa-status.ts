import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateRequest, json } from "@/lib/auth.server";
import { getMpesaUrls } from "@/lib/mpesa-config.server";
import { getDarajaToken } from "@/lib/daraja-token.server";

// Query M-Pesa STK Push status for a transaction.
// Body: { transaction_id: string }
// Returns: { status: "pending" | "confirmed" | "failed" | "cancelled", result_desc?: string }
export const Route = createFileRoute("/api/mpesa-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authResult = await authenticateRequest(request);
          if (authResult instanceof Response) return authResult;
          const { userId } = authResult;

          const body = (await request.json()) as { transaction_id?: string };
          const txId = String(body.transaction_id ?? "");
          if (!txId) return json({ error: "transaction_id required" }, 400);

          const { data: tx } = await supabaseAdmin
            .from("transactions")
            .select("id, user_id, pool_id, amount, status, type, mpesa_checkout_id, mpesa_reference")
            .eq("id", txId)
            .maybeSingle();

          if (!tx || tx.user_id !== userId) return json({ error: "Not found" }, 404);

          // Already settled — return current state
          if (tx.status === "confirmed" || tx.status === "failed" || tx.status === "cancelled") {
            return json({
              status: tx.status,
              receipt: tx.status === "confirmed" ? (tx.mpesa_reference ?? null) : null,
            });
          }

          if (!tx.mpesa_checkout_id) {
            return json({ status: "pending" });
          }

          // Daraja credentials
          const consumerKey = process.env.MPESA_CONSUMER_KEY;
          const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
          const shortcode = process.env.MPESA_SHORTCODE;
          const passkey = process.env.MPESA_PASSKEY;
          if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
            return json({ status: "pending" });
          }

          // OAuth token
          const mpesaUrls = getMpesaUrls();
          let access_token: string;
          try {
            access_token = await getDarajaToken(consumerKey, consumerSecret);
          } catch {
            return json({ status: "pending" });
          }

          const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
          const password = btoa(`${shortcode}${passkey}${ts}`);

          const queryRes = await fetch(
            mpesaUrls.stkQuery,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${access_token}`,
              },
              body: JSON.stringify({
                BusinessShortCode: shortcode,
                Password: password,
                Timestamp: ts,
                CheckoutRequestID: tx.mpesa_checkout_id,
              }),
            },
          );

          const queryData = (await queryRes.json()) as {
            ResultCode?: string;
            ResultDesc?: string;
            errorCode?: string;
            errorMessage?: string;
          };

          // ResultCode "0" = success; "1032" = cancelled by user; "1037" = timeout; others = failed
          // errorCode "500.001.1001" = still processing
          if (queryData.errorCode === "500.001.1001") {
            return json({ status: "pending", result_desc: "Awaiting user PIN" });
          }

          const code = queryData.ResultCode;
          if (code === "0") {
            // Safaricom says the customer paid, but only the callback (which carries the receipt)
            // settles the wallet. Never report "confirmed" until our own record says so.
            return json({ status: "pending", result_desc: "Payment received, finalising" });
          }

          // Cancelled or failed. This route is READ-ONLY (review decision D5): it reports what
          // Daraja said so the sheet can show it, but it never writes to `transactions`. Only the
          // callback (or the reconcile route, on an explicit terminal code) settles a row.
          const isCancelled = code === "1032";
          const newStatus = isCancelled ? "cancelled" : "failed";
          return json({ status: newStatus, result_desc: queryData.ResultDesc });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          return json({ error: msg, status: "pending" }, 500);
        }
      },
    },
  },
});


