import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateRequest, json } from "@/lib/auth.server";
import { readCapabilities } from "@/features/settings/capabilities.server";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/capabilities")({
  server: { handlers: { GET: async ({ request }) => {
    const auth = await authenticateRequest(request);
    if (auth instanceof Response) return auth;
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
    if (!url || !key) return json({ error: "Account service unavailable" }, 503);
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${auth.token}` } },
    });
    // Revalidate the session, not caller-provided identity or role fields.
    const { data, error } = await client.auth.getUser(auth.token);
    if (error || data.user?.id !== auth.userId) return json({ error: "Unauthorized" }, 401);
    try {
      const result = await readCapabilities(client, auth.userId);
      return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return json({ error: "Account capabilities unavailable" }, 503);
    }
  } } },
});