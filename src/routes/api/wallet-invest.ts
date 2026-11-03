import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/rate-limit.server";
import { authenticateRequest, json } from "@/lib/auth.server";
import { requireFreshAal2 } from "@/lib/mfa.server";
import { checkTransactionLimit } from "@/lib/limits.server";
import { screenTransaction } from "@/lib/aml.server";
import { investInPool } from "@/lib/ledger.server";
import { moneyErrorResponse } from "@/lib/money-errors";

// Move wallet money into a pool. Body: { pool_id, amount (whole KES), request_id?: uuid }
// One database transaction (invest_in_pool): wallet debit, holding credit and the transaction
// record succeed or fail together. A repeat of the same request_id returns the first result.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/wallet-invest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authResult = await authenticateRequest(request);
          if (authResult instanceof Response) return authResult;
          const { userId, claims } = authResult;
          if (!rateLimit(`invest:${userId}`, 10, 60_000)) return json({ error: "Too many requests" }, 429);

          const mfaBlock = await requireFreshAal2(userId, claims);
          if (mfaBlock) return mfaBlock;

          const body = (await request.json()) as { pool_id?: string; amount?: number; request_id?: string };
          const poolId = String(body.pool_id ?? "");
          const amount = Number(body.amount);
          if (!UUID.test(poolId)) return json({ error: "Invalid pool_id format" }, 400);
          if (!Number.isFinite(amount) || amount < 1) return json({ error: "Amount must be at least KES 1" }, 400);
          if (amount > 10_000_000) return json({ error: "Amount exceeds maximum limit of KES 10,000,000" }, 400);
          const requestId = body.request_id && UUID.test(body.request_id) ? body.request_id : null;

          // Compliance caps (placeholder thresholds - TBD). Skipped for a repeat tap, which
          // creates nothing new.
          const limit = await checkTransactionLimit(userId, "invest", amount);
          if (!limit.ok) return json({ error: limit.error }, 400);

          const res = await investInPool({ userId, poolId, amount, requestId });
          const failure = moneyErrorResponse(res);
          if (failure) return json(failure.body, failure.status);

          if (res.result === "replayed") {
            return json({ success: true, replayed: true, transaction_id: res.transaction_id, amount: Number(res.net) });
          }

          try {
            await screenTransaction({ userId, transactionId: String(res.transaction_id), amount, kind: "invest" });
          } catch (e) {
            console.error("[wallet-invest] AML screening failed", e);
          }
          return json({
            success: true,
            transaction_id: res.transaction_id,
            amount: Number(res.amount),
            units: Number(res.units),
            new_balance: Number(res.new_balance),
          });
        } catch (e) {
          console.error("[wallet-invest] error", e);
          return json({ error: "Could not process the investment" }, 500);
        }
      },
    },
  },
});
