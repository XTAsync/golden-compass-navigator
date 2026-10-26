import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { authResponse, hasSameOrigin, hashPassword, hashSessionToken, newSessionToken, normalizeKenyanPhone, requestUserAgent, sessionCookie } from "@/lib/standalone-auth.server";
import { rateLimit } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/auth/register")({
  server: { handlers: {
    POST: async ({ request }) => {
      try {
        if (!hasSameOrigin(request)) return authResponse({ error: "Invalid request origin." }, 403);
        const body = await request.json() as { email?: string; password?: string; fullName?: string; phone?: string };
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        const fullName = String(body.fullName ?? "").trim();
        const phone = normalizeKenyanPhone(String(body.phone ?? ""));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return authResponse({ error: "Enter a valid email address." }, 400);
        if (fullName.length < 2 || fullName.length > 120) return authResponse({ error: "Enter your full name." }, 400);
        if (!phone) return authResponse({ error: "Enter a valid Kenyan mobile number." }, 400);
        if (password.length < 8 || password.length > 128) return authResponse({ error: "Password must be 8–128 characters." }, 400);
        if (!rateLimit(`auth-register:${email}`, 4, 15 * 60_000)) return authResponse({ error: "Too many registration attempts. Try again later." }, 429);

        const db = getDb();
        const passwordHash = await hashPassword(password);
        const token = newSessionToken();
        const tokenHash = hashSessionToken(token);
        await db.begin(async tx => {
          const [user] = await tx`
            INSERT INTO public.app_users(email, password_hash, full_name)
            VALUES (${email}, ${passwordHash}, ${fullName})
            RETURNING id
          `;
          await tx`UPDATE public.profiles SET phone = ${phone} WHERE id = ${user.id}`;
          await tx`
            INSERT INTO public.auth_sessions(token_hash, user_id, expires_at, user_agent)
            VALUES (${tokenHash}, ${user.id}, now() + interval '30 days', ${requestUserAgent(request)})
          `;
        });
        return authResponse({ success: true }, 201, { "Set-Cookie": sessionCookie(token, request) });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") {
          return authResponse({ error: "An account already exists with that email or phone number." }, 409);
        }
        console.error("[auth/register] request failed", error instanceof Error ? error.message : "unknown error");
        return authResponse({ error: "Registration could not be completed." }, 500);
      }
    },
  } },
});
