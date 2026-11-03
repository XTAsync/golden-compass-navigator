import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/rate-limit.server";
import { authenticateRequest } from "@/lib/auth.server";
import { moneyConfig } from "@/lib/ledger.server";

// GET /api/money-config?source=wallet|pool&pool_id=<uuid>&amount=<kes>
// One read for the wallet sheets (design D8, D18; eng D7): the fee quote for an amount, pause and
// daily-cap status, and the user's pending amounts. Read-only and advisory: the money functions
// re-check everything when the user submits. Fails closed (the sheet disables its button).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/money-config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateRequest(request);
        if (auth instanceof Response) return auth;
        const { userId } = auth;
        if (!rateLimit(`money-config:${userId}`, 30, 60_000)) {
          return Response.json({ error: "Too many requests" }, { status: 429, headers: noStore });
        }
        const url = new URL(request.url);
        const source = url.searchParams.get("source");
        const poolId = url.searchParams.get("pool_id");
        const amountRaw = url.searchParams.get("amount");
        if (source !== null && source !== "wallet" && source !== "pool") {
          return Response.json({ error: "Invalid source" }, { status: 400, headers: noStore });
        }
        if (poolId && !UUID.test(poolId)) {
          return Response.json({ error: "Invalid pool_id" }, { status: 400, headers: noStore });
        }
        const amount = amountRaw == null || amountRaw === "" ? null : Number(amountRaw);
        if (amount !== null && !Number.isFinite(amount)) {
          return Response.json({ error: "Invalid amount" }, { status: 400, headers: noStore });
        }
        try {
          const cfg = await moneyConfig({
            userId,
            source: source as "wallet" | "pool" | null,
            poolId,
            amount: source ? amount : null,
          });
          return Response.json(cfg, { headers: noStore });
        } catch (e) {
          console.error("[money-config] failed", e);
          return Response.json({ error: "Could not load" }, { status: 502, headers: noStore });
        }
      },
    },
  },
});
