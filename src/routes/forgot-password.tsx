import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CompassEmblem } from "@/components/CompassEmblem";
import { ParallaxBackground } from "@/components/ParallaxBackground";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Reset Your Password — Golden Compass" },
      { name: "description", content: "Request a secure password reset link for your Golden Compass investor account." },
      { property: "og:title", content: "Reset Your Password — Golden Compass" },
      { property: "og:description", content: "Request a secure password reset link." },
      { property: "og:url", content: "/forgot-password" },
    ],
    links: [{ rel: "canonical", href: "/forgot-password" }],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email) return setError("Enter the email on your account.");
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (err) return setError(err.message);
    setSent(true);
  };

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "var(--ocean-0)" }}>
      <ParallaxBackground />
      <div className="relative z-10 mx-auto flex flex-col h-full overflow-y-auto" style={{ maxWidth: 430 }}>
        <div className="flex flex-col items-center text-center" style={{ padding: "44px 28px 24px" }}>
          <div className="anim-emblem anim-float">
            <CompassEmblem />
          </div>
          <h1 className="t-display t-gold mt-4" style={{ fontSize: 22, letterSpacing: "0.04em" }}>
            Reset your password
          </h1>
          <p className="t-serif t-sec mt-2" style={{ fontSize: 13, fontStyle: "italic" }}>
            We'll send a reset link to your email.
          </p>
        </div>

        <div style={{ padding: "0 24px 40px" }}>
          {sent ? (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-3xl mb-3">📨</p>
              <p className="t-serif t-parch" style={{ fontSize: 15 }}>
                Check your inbox for a reset link.
              </p>
              <p className="t-mono t-muted mt-2" style={{ fontSize: 10 }}>
                It may take a minute. Check spam too.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="glass rounded-2xl p-5 space-y-4">
              <div className="gc-input-wrap">
                <label className="gc-input-label">Email</label>
                <input
                  type="email"
                  className="gc-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {error && (
                <p className="t-mono" style={{ fontSize: 11, color: "var(--gc-danger)" }}>
                  {error}
                </p>
              )}
              <button type="submit" disabled={loading} className="btn-brass w-full" style={{ height: 52, fontSize: 12 }}>
                {loading ? "Sending…" : "✉ Send Reset Link"}
              </button>
            </form>
          )}

          <p className="text-center mt-5">
            <Link to="/login" className="t-mono t-sec" style={{ fontSize: 10, textDecoration: "underline" }}>
              ← Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
