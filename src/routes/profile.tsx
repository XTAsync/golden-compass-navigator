import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Profile — Golden Compass" },
      { name: "description", content: "Manage your Golden Compass account, KYC verification status and personal settings." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Profile — Golden Compass" },
      { property: "og:description", content: "Your account, KYC status and settings." },
      { property: "og:url", content: "/profile" },
    ],
    links: [{ rel: "canonical", href: "/profile" }],
  }),
  component: ProfilePage,
});

interface Profile {
  full_name: string;
  phone: string | null;
  kyc_status: string;
  created_at: string;
}

function ProfilePage() {
  const { user, signOut, loading: authLoading } = useAuth();
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, phone, kyc_status, created_at")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setProfile(data as Profile | null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const kycBadge = (status: string) => {
    const map: Record<string, { color: string; label: string }> = {
      not_started: { color: "var(--gc-warning)", label: "NOT STARTED" },
      pending: { color: "var(--gc-info)", label: "UNDER REVIEW" },
      approved: { color: "var(--gc-success)", label: "VERIFIED" },
      rejected: { color: "var(--gc-danger)", label: "REJECTED" },
    };
    const v = map[status] ?? map.not_started;
    return (
      <span
        className="t-mono inline-flex items-center"
        style={{
          fontSize: 9,
          letterSpacing: "0.14em",
          color: v.color,
          padding: "4px 10px",
          borderRadius: 999,
          background: `${v.color}1A`,
          border: `1px solid ${v.color}55`,
        }}
      >
        {v.label}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
          ACCOUNT
        </p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>
          Profile
        </h1>
      </header>

      {loading ? (
        <>
          <div className="skeleton h-32 w-full rounded-2xl" />
          <div className="skeleton h-24 w-full rounded-2xl" />
        </>
      ) : (
        <>
          <div className="glass-gold rounded-2xl p-5 text-center">
            <div
              className="mx-auto w-16 h-16 rounded-full flex items-center justify-center t-display t-gold"
              style={{
                fontSize: 22,
                background: "radial-gradient(circle at 30% 30%, rgba(201,168,76,0.3), transparent 70%)",
                border: "1px solid rgba(201,168,76,0.4)",
              }}
            >
              {(profile?.full_name || "?").charAt(0).toUpperCase()}
            </div>
            <h2 className="t-display t-parch mt-3" style={{ fontSize: 18 }}>
              {profile?.full_name || "Investor"}
            </h2>
            <p className="t-mono t-muted mt-1" style={{ fontSize: 10 }}>
              {user?.email}
            </p>
            {profile?.phone && (
              <p className="t-mono t-sec mt-1" style={{ fontSize: 10 }}>
                {profile.phone}
              </p>
            )}
            <div className="mt-4 flex items-center justify-center gap-2">
              {kycBadge(profile?.kyc_status ?? "not_started")}
              {isAdmin && (
                <span
                  className="t-mono"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.14em",
                    color: "var(--gold-300)",
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "rgba(201,168,76,0.10)",
                    border: "1px solid rgba(201,168,76,0.4)",
                  }}
                >
                  ADMIN
                </span>
              )}
            </div>
          </div>

          <div className="glass rounded-2xl overflow-hidden">
            {profile?.kyc_status !== "approved" && (
              <Link
                to="/kyc"
                className="flex items-center justify-between px-5 py-4 border-b"
                style={{ borderColor: "rgba(255,255,255,0.06)", textDecoration: "none" }}
              >
                <span className="t-serif t-parch" style={{ fontSize: 14 }}>
                  📋 Complete KYC
                </span>
                <span className="t-gold" style={{ fontSize: 14 }}>›</span>
              </Link>
            )}
            <Link
              to="/portfolio"
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)", textDecoration: "none" }}
            >
              <span className="t-serif t-parch" style={{ fontSize: 14 }}>
                Portfolio
              </span>
              <span className="t-gold" style={{ fontSize: 14 }}>›</span>
            </Link>
            <Link
              to="/orders"
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)", textDecoration: "none" }}
            >
              <span className="t-serif t-parch" style={{ fontSize: 14 }}>
                🧾 Order History
              </span>
              <span className="t-gold" style={{ fontSize: 14 }}>›</span>
            </Link>
            <Link
              to="/history"
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)", textDecoration: "none" }}
            >
              <span className="t-serif t-parch" style={{ fontSize: 14 }}>
                📜 Transaction History
              </span>
              <span className="t-gold" style={{ fontSize: 14 }}>›</span>
            </Link>

            {isAdmin && (
              <Link
                to="/admin"
                className="flex items-center justify-between px-5 py-4 border-b"
                style={{ borderColor: "rgba(255,255,255,0.06)", textDecoration: "none" }}
              >
                <span className="t-serif t-gold" style={{ fontSize: 14 }}>
                  Admin Panel
                </span>
                <span className="t-gold" style={{ fontSize: 14 }}>›</span>
              </Link>
            )}
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/login" });
              }}
              className="w-full flex items-center justify-between px-5 py-4 bg-transparent border-none cursor-pointer"
            >
              <span className="t-serif" style={{ fontSize: 14, color: "var(--gc-danger)" }}>
                ⎋ Sign Out
              </span>
            </button>
          </div>

          <div className="glass rounded-2xl overflow-hidden">
            <p
              className="t-mono t-muted px-5 pt-4 pb-2"
              style={{ fontSize: 9, letterSpacing: "0.16em" }}
            >
              LEGAL
            </p>
            {([
              ["/legal/terms", "📄 Terms of Service"],
              ["/legal/privacy", "🔒 Privacy Policy"],
              ["/legal/risk-disclosure", "⚠️ Risk Disclosure"],
            ] as const).map(([to, label]) => (
              <Link
                key={to}
                to={to}
                className="flex items-center justify-between px-5 py-4 border-t"
                style={{ borderColor: "rgba(255,255,255,0.06)", textDecoration: "none" }}
              >
                <span className="t-serif t-parch" style={{ fontSize: 14 }}>{label}</span>
                <span className="t-gold" style={{ fontSize: 14 }}>›</span>
              </Link>
            ))}
          </div>

          <p className="t-mono t-muted text-center" style={{ fontSize: 9, letterSpacing: "0.1em" }}>
            MEMBER SINCE {profile?.created_at ? new Date(profile.created_at).getFullYear() : "—"}
          </p>

        </>
      )}
    </div>
  );
}
