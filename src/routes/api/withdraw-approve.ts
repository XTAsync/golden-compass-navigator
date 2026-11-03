import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateRequest, json } from "@/lib/auth.server";
import { getMpesaUrls } from "@/lib/mpesa-config.server";
import { getDarajaToken } from "@/lib/daraja-token.server";
import { isMpesaLiveEnabled } from "@/lib/config.server";
import { withCallbackSecret } from "@/lib/mpesa-security.server";
import { approveWithdrawalStart, failWithdrawal } from "@/lib/ledger.server";

// Admin approves a withdrawal -> automatically calls M-Pesa B2C to pay out.
// Body: { transaction_id: string, action: "approve" | "reject" }
//
// State machine (each step is an atomic database function, so two admins or a double click can
// never pay twice):
//   pending --approve--> processing --B2C result callback--> confirmed | failed(+refund)
//   pending --reject---> failed(+refund)
//
// IMPORTANT: we only refund automatically when we KNOW no payout was sent (M-Pesa auth failed, or
// Safaricom explicitly rejected the request). If the B2C request may have reached Safaricom but we
// lost the response (network error), the withdrawal stays 'processing' for manual reconciliation -
// refunding there could pay the user twice.
export const Route = createFileRoute("/api/withdraw-approve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authResult = await authenticateRequest(request);
          if (authResult instanceof Response) return authResult;
          const { userId: adminId } = authResult;

          const { data: adminRole } = await supabaseAdmin
            .from("user_roles")
            .select("role")
            .eq("user_id", adminId)
            .eq("role", "admin")
            .maybeSingle();
          if (!adminRole) return json({ error: "Forbidden: admin only" }, 403);

          const body = (await request.json()) as {
            transaction_id?: string;
            action?: "approve" | "reject";
          };
          const txId = String(body.transaction_id ?? "");
          const action = body.action;
          if (!txId || (action !== "approve" && action !== "reject"))
            return json({ error: "Invalid input" }, 400);

          // ---- REJECT: fail + refund, only from 'pending' ----
          if (action === "reject") {
            const res = await failWithdrawal(txId, "Rejected by admin", ["pending"]);
            if (res.result === "failed") return json({ success: true, status: "failed" });
            if (res.result === "not_found") return json({ error: "Transaction not found" }, 404);
            if (res.result === "not_a_withdrawal") return json({ error: "Not a withdrawal" }, 400);
            return json({ error: "Already processed" }, 400);
          }

          // ---- APPROVE ----
          if (!(await isMpesaLiveEnabled()))
            return json({ error: "Real payouts are disabled pending compliance approval." }, 403);

          // Check configuration BEFORE moving the withdrawal to 'processing', so a config problem
          // never strands a payout.
          const initiator = process.env["MPESA_INITIATOR_NAME"];
          const securityCredential = process.env["MPESA_SECURITY_CREDENTIAL"];
          const b2cShortcode = process.env["MPESA_B2C_SHORTCODE"];
          const consumerKey = process.env.MPESA_CONSUMER_KEY;
          const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
          const callbackBase = process.env.MPESA_CALLBACK_URL;
          if (
            !consumerKey ||
            !consumerSecret ||
            !callbackBase ||
            !initiator ||
            !securityCredential ||
            !b2cShortcode
          ) {
            return json({ error: "M-Pesa credentials not configured" }, 500);
          }
          let resultUrl = "";
          let timeoutUrl = "";
          try {
            const u = new URL(
              /^https?:\/\//i.test(callbackBase) ? callbackBase : "https://" + callbackBase,
            );
            resultUrl = withCallbackSecret(`${u.origin}/api/mpesa-b2c-result`);
            timeoutUrl = withCallbackSecret(`${u.origin}/api/mpesa-b2c-timeout`);
          } catch {
            return json({ error: "Invalid MPESA_CALLBACK_URL" }, 500);
          }

          // Atomically move pending -> processing (only once, only for a real reserved withdrawal).
          const start = await approveWithdrawalStart(txId, adminId);
          switch (start.result) {
            case "ok":
              break;
            case "not_found":
              return json({ error: "Transaction not found" }, 404);
            case "not_a_withdrawal":
              return json({ error: "Not a withdrawal" }, 400);
            case "forbidden":
              return json({ error: "Forbidden: admin only" }, 403);
            case "paused":
              return json({ error: "Withdrawals are paused. Unpause before approving." }, 503);
            case "self_approval":
              return json(
                { error: "You cannot approve your own withdrawal. Ask another admin." },
                403,
              );
            case "not_reserved":
              return json(
                { error: "This withdrawal has no reserved holdings and cannot be paid" },
                400,
              );
            default:
              return json({ error: "Already processed" }, 400);
          }
          const payoutPhone = String(start.payout_phone ?? "");
          const amount = Math.floor(Number(start.amount));
          if (!payoutPhone || !(amount >= 1)) {
            await failWithdrawal(txId, "Missing payout phone or amount", ["processing"]);
            return json({ error: "Missing payout phone on transaction" }, 400);
          }

          // OAuth token. A failure here means nothing was sent to Safaricom: safe to refund.
          const mpesaUrls = getMpesaUrls();
          let access_token: string;
          try {
            access_token = await getDarajaToken(consumerKey, consumerSecret);
          } catch {
            await failWithdrawal(txId, "M-Pesa auth failed", ["processing"]);
            return json({ error: "M-Pesa auth failed" }, 502);
          }

          const b2cBody = {
            OriginatorConversationID: `GC-WD-${txId}`,
            InitiatorName: initiator,
            SecurityCredential: securityCredential,
            CommandID: "BusinessPayment",
            Amount: amount,
            PartyA: b2cShortcode,
            PartyB: payoutPhone,
            Remarks: `Golden Compass withdrawal ${txId.slice(0, 8)}`,
            QueueTimeOutURL: timeoutUrl, // separate route: a timeout is an unknown outcome, never a refund
            ResultURL: resultUrl,
            Occasion: txId,
          };

          let b2cOk = false;
          let b2cData: {
            ResponseCode?: string;
            ConversationID?: string;
            errorMessage?: string;
            ResponseDescription?: string;
          } = {};
          try {
            const b2cRes = await fetch(mpesaUrls.b2c, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${access_token}`,
              },
              body: JSON.stringify(b2cBody),
            });
            b2cData = (await b2cRes.json()) as typeof b2cData;
            b2cOk = b2cRes.ok && b2cData.ResponseCode === "0";
          } catch (e) {
            // AMBIGUOUS: the request may have reached Safaricom. Do NOT refund. Leave 'processing'
            // so an admin can reconcile with the M-Pesa statement, and record it.
            console.error("[withdraw-approve] B2C outcome unknown", { txId, error: e });
            await supabaseAdmin.from("audit_logs").insert({
              actor_email: `admin:${adminId}`,
              action: "withdrawal_payout_outcome_unknown",
              entity_type: "transaction",
              entity_id: txId,
              metadata: {
                note: "B2C request failed after being sent; reconcile before refunding or retrying",
              },
            });
            return json(
              {
                error:
                  "Payout status unknown. Check the M-Pesa statement before retrying; the withdrawal stays in processing.",
              },
              502,
            );
          }

          if (!b2cOk) {
            // Safaricom answered and explicitly rejected it: nothing was paid, safe to refund.
            const reason =
              b2cData.errorMessage || b2cData.ResponseDescription || "B2C request rejected";
            await failWithdrawal(txId, reason, ["processing"]);
            return json({ error: reason }, 502);
          }

          // Store the conversation id so the result callback can match.
          const { error: convErr } = await supabaseAdmin
            .from("transactions")
            .update({ mpesa_checkout_id: b2cData.ConversationID ?? null })
            .eq("id", txId);
          if (convErr) console.error("[withdraw-approve] could not store conversation id", convErr);

          return json({
            success: true,
            status: "processing",
            message: "Payout submitted. Completion depends on the payment provider.",
          });
        } catch (e) {
          console.error("[withdraw-approve] error", e);
          return json({ error: "Could not process the approval" }, 500);
        }
      },
    },
  },
});
