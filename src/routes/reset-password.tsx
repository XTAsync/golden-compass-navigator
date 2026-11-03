import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CompassEmblem } from "@/components/CompassEmblem";
import { ParallaxBackground } from "@/components/ParallaxBackground";
import { validatePassword } from "@/lib/password-policy";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Set a New Password — Golden Compass" },
      { name: "description", content: "Choose a new password for your Golden Compass investor account." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Set a New Password — Golden Compass" },
      { property: "og:description", content: "Choose a new password for your account." },
      { property: "og:url", content: "/reset-password" },
    ],
    links: [{ rel: "canonical", href: "/reset-password" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [linkValid, setLinkValid] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const hash = window.location.hash ?? "";
    const isRecovery = hash.includes("type=recovery") || hash.includes("access_token");

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setLinkValid(true);
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setLinkValid(Boolean(data.session) || isRecovery);
      setReady(true);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const passwordError = validatePassword(password);
    if (passwordError) return setError(passwordError);
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) return setError(err.message);
    setDone(true);
    setTimeout(() => navigate({ to: "/home" }), 1400);
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
            Set a New Password
          </h1>
        </div>

        <div style={{ padding: "0 24px 40px" }}>
          {!ready ? (
            <div className="skeleton h-40 w-full rounded-2xl" />
          ) : done ? (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-3xl mb-3">✓</p>
              <p className="t-serif t-parch" style={{ fontSize: 15 }}>Password updated.</p>
            </div>
          ) : !linkValid ? (
            <div className="glass rounded-2xl p-6 text-center">
              <p className="text-3xl mb-3">⚠️</p>
              <p className="t-serif t-parch" style={{ fontSize: 15 }}>
                This reset link is invalid or has expired.
              </p>
              <Link
                to="/forgot-password"
                className="btn-brass inline-flex mt-4"
                style={{ padding: "10px 20px", fontSize: 11, textDecoration: "none" }}
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="glass rounded-2xl p-5 space-y-4">
              <div className="gc-input-wrap">
                <label className="gc-input-label">New Password</label>
                <input
                  type="password"
                  className="gc-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="gc-input-wrap">
                <label className="gc-input-label">Confirm Password</label>
                <input
                  type="password"
                  className="gc-input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && (
                <p className="t-mono" style={{ fontSize: 11, color: "var(--gc-danger)" }}>
                  {error}
                </p>
              )}
              <button type="submit" disabled={loading} className="btn-brass w-full" style={{ height: 52, fontSize: 12 }}>
                {loading ? "Updating…" : "Update Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
