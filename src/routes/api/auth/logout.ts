import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { authResponse, clearSessionCookie, hashSessionToken, readSessionToken } from "@/lib/standalone-auth.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: { handlers: {
    POST: async ({ request }) => {
      try {
        const token = readSessionToken(request);
        if (token) {
          await getDb()`UPDATE public.auth_sessions SET revoked_at = now()
                        WHERE token_hash = ${hashSessionToken(token)} AND revoked_at IS NULL`;
        }
        return authResponse({ success: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
      } catch (error) {
        console.error("[auth/logout] request failed", error instanceof Error ? error.message : "unknown error");
        return authResponse({ error: "Sign-out failed." }, 500, { "Set-Cookie": clearSessionCookie(request) });
      }
    },
  } },
});
