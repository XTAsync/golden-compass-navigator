import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/rate-limit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normaliseKenyanPhone } from "@/lib/phone";
import { authenticateRequest, json } from "@/lib/auth.server";
import { getMpesaUrls } from "@/lib/mpesa-config.server";
import { getDarajaToken } from "@/lib/daraja-token.server";
import { checkTransactionLimit } from "@/lib/limits.server";
import { screenTransaction } from "@/lib/aml.server";
import { isMpesaLiveEnabled } from "@/lib/config.server";
import { withCallbackSecret, mayStartMpesaPayment } from "@/lib/mpesa-security.server";
import { attachCheckoutId, failDeposit } from "@/lib/ledger.server";

// Initiate an M-Pesa STK Push for a deposit. Authenticated users only.
// Body: { amount: number, pool_id: string, phone: string }
export const Route = createFileRoute("/api/mpesa-stk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authResult = await authenticateRequest(request);
          if (authResult instanceof Response) return authResult;
          const { userId } = authResult;
          if (!mayStartMpesaPayment(await isMpesaLiveEnabled())) {
            return json({ error: "M-Pesa payments are disabled in this environment." }, 403);
          }
          if (!rateLimit(userId, 5, 60_000)) return json({ error: "Too many requests" }, 429);

          const body = (await request.json()) as { amount?: number; phone?: string };
          const amount = Math.floor(Number(body.amount));
          // Deposits ALWAYS go to wallet — pool_id is ignored on the server.
          const pool_id: string | null = null;
          const phoneRaw = String(body.phone ?? "").replace(/\D/g, "");

          if (!amount || amount < 1) return json({ error: "Amount must be at least KES 1" }, 400);
          if (amount > 150_000) return json({ error: "Amount exceeds M-Pesa limit of KES 150,000" }, 400);
          // Normalize phone
          const phone = normaliseKenyanPhone(phoneRaw);
          if (!phone) return json({ error: "Invalid Kenyan phone number" }, 400);

          // Compliance caps (placeholder thresholds — TBD).
          const limit = await checkTransactionLimit(userId, "deposit", amount);
          if (!limit.ok) return json({ error: limit.error }, 400);

          // Daraja credentials
          const consumerKey = process.env.MPESA_CONSUMER_KEY;
          const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
          const shortcode = process.env.MPESA_SHORTCODE;
          const passkey = process.env.MPESA_PASSKEY;
          let callbackUrl = process.env.MPESA_CALLBACK_URL;
          if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) {
            return json({ error: "M-Pesa credentials not configured" }, 500);
          }
          // Normalize: ensure scheme + correct path
          if (!/^https?:\/\//i.test(callbackUrl)) callbackUrl = "https://" + callbackUrl;
          try {
            const u = new URL(callbackUrl);
            // Force the actual handler path regardless of what was configured
            u.pathname = "/api/mpesa-callback";
            // Authenticate Safaricom's callback with a secret in the URL (see mpesa-security.server.ts)
            callbackUrl = withCallbackSecret(u.toString());
          } catch {
            return json({ error: "Invalid MPESA_CALLBACK_URL" }, 500);
          }

          // OAuth token
          const mpesaUrls = getMpesaUrls();
          let access_token: string;
          try {
            access_token = await getDarajaToken(consumerKey, consumerSecret);
          } catch {
            return json({ error: "M-Pesa auth failed" }, 502);
          }

          const ts = new Date()
            .toISOString()
            .replace(/[-:T.Z]/g, "")
            .slice(0, 14);
          const password = btoa(`${shortcode}${passkey}${ts}`);

          // Create pending transaction first so callback can find it
          const { data: tx, error: txErr } = await supabaseAdmin
            .from("transactions")
            .insert({
              user_id: userId,
              pool_id,
              amount,
              type: "deposit",
              status: "pending",
            })
            .select("id")
            .single();
          if (txErr || !tx) return json({ error: "Failed to record transaction" }, 500);

          const stkBody = {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: ts,
            TransactionType: "CustomerPayBillOnline",
            Amount: amount,
            PartyA: phone,
            PartyB: shortcode,
            PhoneNumber: phone,
            CallBackURL: callbackUrl,
            AccountReference: `GC-${tx.id.slice(0, 8)}`,
            TransactionDesc: `Wallet top-up`,
          };

          const stkRes = await fetch(mpesaUrls.stkPush, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${access_token}`,
            },
            body: JSON.stringify(stkBody),
          });
          const stkData = (await stkRes.json()) as {
            ResponseCode?: string;
            CheckoutRequestID?: string;
            errorMessage?: string;
            ResponseDescription?: string;
          };

          if (!stkRes.ok || stkData.ResponseCode !== "0") {
            const reason =
              stkData.errorMessage || stkData.ResponseDescription || "STK Push failed";
            console.error("[mpesa-stk] failure", { status: stkRes.status, body: stkData });
            await failDeposit(tx.id, `STK: ${reason}`);
            return json({ error: reason }, 502);
          }

          // Save the checkout id atomically. If Safaricom's callback already arrived, this also
          // settles it (see supabase/migrations/20261027120000_mpesa_callback_inbox.sql).
          if (stkData.CheckoutRequestID) {
            try {
              const att = await attachCheckoutId(tx.id, stkData.CheckoutRequestID);
              const settlement = att.settlement as { result?: string; amount?: number } | undefined;
              if (att.result === "replayed" && settlement?.result === "confirmed") {
                await supabaseAdmin.from("notifications").insert({
                  user_id: userId,
                  type: "deposit",
                  title: "Wallet credited",
                  body: `KES ${Number(settlement.amount).toLocaleString()} added to your wallet.`,
                });
              }
            } catch (e) {
              // Never lose the checkout id: fall back to the plain save (pre-migration behaviour).
              console.error("[mpesa-stk] attach_checkout_id failed, saving id directly", { txId: tx.id, error: e });
              await supabaseAdmin
                .from("transactions")
                .update({ mpesa_checkout_id: stkData.CheckoutRequestID })
                .eq("id", tx.id);
            }
          }

          return json({
            success: true,
            transaction_id: tx.id,
            checkout_id: stkData.CheckoutRequestID,
            message: "Check your phone for the M-Pesa prompt",
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          return json({ error: msg }, 500);
        }
      },
    },
  },
});


