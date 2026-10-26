import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { authResponse, hashSessionToken, newSessionToken, requestUserAgent, sessionCookie, verifyPassword } from "@/lib/standalone-auth.server";
import { rateLimit } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/auth/login")({
  server: { handlers: {
    POST: async ({ request }) => {
      try {
        const body = await request.json() as { email?: string; password?: string };
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        if (!email || !password || email.length > 254 || password.length > 128) return authResponse({ error: "Invalid email or password." }, 400);
        if (!rateLimit(`auth-login:${email}`, 8, 15 * 60_000)) return authResponse({ error: "Too many sign-in attempts. Try again later." }, 429);

        const db = getDb();
        const rows = await db`SELECT id::text AS id, email, password_hash, is_disabled
                               FROM public.app_users WHERE lower(email) = ${email} LIMIT 1`;
        const user = rows[0] as { id: string; email: string; password_hash: string; is_disabled: boolean } | undefined;
        if (!user || user.is_disabled || !(await verifyPassword(password, user.password_hash))) {
          return authResponse({ error: "Invalid email or password." }, 401);
        }

        const token = newSessionToken();
        await db`
          INSERT INTO public.auth_sessions(token_hash, user_id, expires_at, user_agent)
          VALUES (${hashSessionToken(token)}, ${user.id}, now() + interval '30 days', ${requestUserAgent(request)})
        `;
        return authResponse({ success: true }, 200, { "Set-Cookie": sessionCookie(token, request) });
      } catch (error) {
        console.error("[auth/login] request failed", error instanceof Error ? error.message : "unknown error");
        return authResponse({ error: "Sign-in is temporarily unavailable." }, 500);
      }
    },
  } },
});
