import { createFileRoute } from "@tanstack/react-router";
import { authResponse, getStandaloneSession } from "@/lib/standalone-auth.server";

export const Route = createFileRoute("/api/auth/session")({
  server: { handlers: {
    GET: async ({ request }) => {
      try {
        const user = await getStandaloneSession(request);
        return authResponse({ user });
      } catch (error) {
        console.error("[auth/session] lookup failed", error instanceof Error ? error.message : "unknown error");
        return authResponse({ error: "Session lookup failed." }, 500);
      }
    },
  } },
});
