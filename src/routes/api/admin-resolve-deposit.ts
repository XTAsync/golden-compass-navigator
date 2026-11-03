import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/rate-limit.server";
import { authenticateRequest, json } from "@/lib/auth.server";
import { resolveHeldDeposit } from "@/lib/ledger.server";

// Admin only (checked inside the database function). Body: { transaction_id, receipt }
export const Route = createFileRoute("/api/admin-resolve-deposit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await authenticateRequest(request);
          if (auth instanceof Response) return auth;
          const { userId } = auth;
          if (!rateLimit(`resolve:${userId}`, 20, 60_000)) return json({ error: "Too many requests" }, 429);

          const body = (await request.json()) as { transaction_id?: string; receipt?: string };
          const txId = String(body.transaction_id ?? "");
          const receipt = String(body.receipt ?? "");
          if (!txId || !receipt) return json({ error: "transaction_id and receipt required" }, 400);

          const res = await resolveHeldDeposit(txId, receipt, userId);
          switch (res.result) {
            case "confirmed":
              return json({ success: true });
            case "forbidden":
              return json({ error: "Forbidden: admin only" }, 403);
            case "invalid_receipt":
              return json({ error: "That is not an M-Pesa receipt. It is 8 to 14 letters and numbers, like QGH7XK2LMN." }, 400);
            case "self_resolve":
              return json({ error: "You cannot resolve your own deposit. Ask another admin." }, 403);
            case "not_found":
              return json({ error: "Deposit not found" }, 404);
            case "duplicate_receipt":
              return json({ error: "That receipt was already used for another deposit." }, 409);
            default:
              return json({ error: "This deposit can't be resolved here. Check its status." }, 400);
          }
        } catch (e) {
          console.error("[admin-resolve-deposit] error", e);
          return json({ error: "Could not resolve the deposit" }, 500);
        }
      },
    },
  },
});
