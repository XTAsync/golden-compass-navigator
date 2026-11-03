import { createFileRoute } from "@tanstack/react-router";
import { authenticateRequest, json } from "@/lib/auth.server";

// Legacy non-atomic settlement stays closed until replaced with isolated demo RPCs.
export const Route = createFileRoute("/api/trade")({
  server: { handlers: { POST: async ({ request }) => {
    const auth = await authenticateRequest(request);
    if (auth instanceof Response) return auth;
    return json({ error: "Order execution is temporarily disabled while demo settlement is upgraded. No funds or holdings have changed." }, 403);
  } } },
});
