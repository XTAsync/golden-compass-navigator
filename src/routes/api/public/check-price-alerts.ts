import { createFileRoute } from "@tanstack/react-router";
import { runPriceAlertScan } from "@/lib/alerts.server";
import { constantTimeEqual, MIN_SECRET_LENGTH } from "@/lib/mpesa-security.server";

// Scheduled price-alert sweep. Call on a cron:
//   POST https://project--<id>.lovable.app/api/public/check-price-alerts
//   header: x-cron-secret: <ALERTS_CRON_SECRET>
// The public prefix bypasses site auth, so the caller is verified here. The secret is a
// dedicated server-only value (review decision D8), never the publishable Supabase key, which
// is public by design. Fails closed when the secret is unset or too short.
export const Route = createFileRoute("/api/public/check-price-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["ALERTS_CRON_SECRET"] ?? "";
        if (expected.length < MIN_SECRET_LENGTH) {
          return Response.json({ error: "Scanner not configured" }, { status: 503 });
        }
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!constantTimeEqual(provided, expected)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          const result = await runPriceAlertScan();
          return Response.json({ ok: true, ...result, ran_at: new Date().toISOString() });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Alert scan failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
