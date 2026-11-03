import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/rate-limit.server";
import { normaliseKenyanPhone } from "@/lib/phone";
import { authenticateRequest, json } from "@/lib/auth.server";
import { requireFreshAal2 } from "@/lib/mfa.server";
import { checkTransactionLimit } from "@/lib/limits.server";
import { screenTransaction } from "@/lib/aml.server";
import { isMpesaLiveEnabled } from "@/lib/config.server";
import { requestWalletWithdrawal, requestWithdrawal } from "@/lib/ledger.server";
import { moneyErrorResponse } from "@/lib/money-errors";

// Body: { source: "wallet" | "pool", pool_id?: string (pool only), amount: number (whole KES),
//         phone: string, request_id?: uuid, expected_net?: number }
// Reserves the user's units and creates a 'pending' withdrawal in ONE database transaction
// (request_withdrawal). Holding period, exit fee, balance check and the reservation all happen
// under a row lock, so parallel requests cannot spend the same holding twice.
// Admins approve from /admin/transactions (off-app B2C payout).
export const Route = createFileRoute("/api/withdraw-request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authResult = await authenticateRequest(request);
          if (authResult instanceof Response) return authResult;
          const { userId, claims } = authResult;
          if (!(await isMpesaLiveEnabled()))
            return json(
              { error: "Real withdrawals are disabled pending compliance approval." },
              403,
            );
          if (!rateLimit(userId, 5, 60_000)) return json({ error: "Too many requests" }, 429);

          const mfaBlock = await requireFreshAal2(userId, claims);
          if (mfaBlock) return mfaBlock;

          const body = (await request.json()) as {
            source?: string;
            pool_id?: string;
            amount?: number;
            phone?: string;
            request_id?: string;
            expected_net?: number;
          };
          const source = body.source === "wallet" ? "wallet" : "pool";
          const pool_id = String(body.pool_id ?? "");
          const amount = Number(body.amount);
          if ((source === "pool" && !pool_id) || !Number.isFinite(amount) || amount <= 0)
            return json({ error: "Invalid input" }, 400);
          const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const requestId = body.request_id && UUID.test(body.request_id) ? body.request_id : null;
          const expectedNet =
            body.expected_net != null && Number.isFinite(Number(body.expected_net))
              ? Number(body.expected_net)
              : null;

          const phoneRaw = String(body.phone ?? "").replace(/\D/g, "");
          const phone = normaliseKenyanPhone(phoneRaw);
          if (!phone) return json({ error: "Invalid M-Pesa phone number" }, 400);

          // Compliance caps (placeholder thresholds - TBD).
          const limit = await checkTransactionLimit(userId, "withdrawal", amount);
          if (!limit.ok) return json({ error: limit.error }, 400);

          const res =
            source === "wallet"
              ? await requestWalletWithdrawal({ userId, amount, phone, requestId, expectedNet })
              : await requestWithdrawal({ userId, poolId: pool_id, amount, phone, requestId, expectedNet });

          const failure = moneyErrorResponse(res);
          if (failure) return json(failure.body, failure.status);

          if (res.result === "replayed") {
            return json({
              success: true,
              replayed: true,
              transaction_id: res.transaction_id,
              status: res.status,
              gross: Number(res.gross),
              fee: Number(res.fee),
              net: Number(res.net),
            });
          }

          const txId = String(res.transaction_id);
          const gross = Number(res.gross);
          const fee = Number(res.fee);
          const net = Number(res.net);

          // AML screening is advisory here (raises a flag for review); the reservation is already safe.
          try {
            await screenTransaction({
              userId,
              transactionId: txId,
              amount: gross,
              kind: "withdrawal",
            });
          } catch (e) {
            console.error("[withdraw-request] AML screening failed", e);
          }

          return json({
            success: true,
            transaction_id: txId,
            gross,
            fee,
            net,
            message: `Withdrawal of KES ${net.toLocaleString("en-KE")} requested${fee > 0 ? ` (fee KES ${fee.toLocaleString("en-KE")})` : ""}. Usually within 24 hours.`,
          });
        } catch (e) {
          console.error("[withdraw-request] error", e);
          return json({ error: "Could not process the withdrawal request" }, 500);
        }
      },
    },
  },
});
