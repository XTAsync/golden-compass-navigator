import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Admin — Golden Compass" },
      { name: "description", content: "Golden Compass operations panel: users, KYC queue, transactions and assets under management." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Admin — Golden Compass" },
      { property: "og:description", content: "Internal operations panel." },
      { property: "og:url", content: "/admin" },
    ],
    links: [{ rel: "canonical", href: "/admin" }],
  }),
  component: AdminHome,
});

function AdminHome() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();

  const [stats, setStats] = useState({
    users: 0,
    pendingKyc: 0,
    pendingTx: 0,
    aum: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (roleLoading) return;
    if (!isAdmin) {
      navigate({ to: "/home" });
      return;
    }
    let cancelled = false;
    (async () => {
      const [usersRes, kycRes, txRes, poolsRes] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("kyc_records").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("transactions").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("investment_pools").select("total_value"),
      ]);
      if (cancelled) return;
      const aum = (poolsRes.data ?? []).reduce((s, p) => s + Number(p.total_value ?? 0), 0);
      setStats({
        users: usersRes.count ?? 0,
        pendingKyc: kycRes.count ?? 0,
        pendingTx: txRes.count ?? 0,
        aum,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, roleLoading, navigate]);

  if (roleLoading || !isAdmin) {
    return (
      <div className="flex items-center justify-center flex-1 px-5">
        <p className="t-mono t-muted" style={{ fontSize: 11 }}>Verifying clearance…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
          OPERATIONS
        </p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>
          Admin Console
        </h1>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="USERS" value={stats.users} loading={loading} />
        <StatCard label="AUM (KES)" value={Math.round(stats.aum).toLocaleString()} loading={loading} />
        <StatCard label="KYC PENDING" value={stats.pendingKyc} loading={loading} highlight={stats.pendingKyc > 0} />
        <StatCard label="TX PENDING" value={stats.pendingTx} loading={loading} highlight={stats.pendingTx > 0} />
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <Link to="/admin/kyc" className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.06)", textDecoration: "none" }}>
          <span className="t-serif t-parch" style={{ fontSize: 14 }}>📋 KYC Review Queue</span>
          <span className="t-gold">›</span>
        </Link>
        <Link to="/admin/transactions" className="flex items-center justify-between px-5 py-4" style={{ textDecoration: "none" }}>
          <span className="t-serif t-parch" style={{ fontSize: 14 }}>💸 All Transactions</span>
          <span className="t-gold">›</span>
        </Link>
      </div>

      <Link
        to="/profile"
        className="t-mono t-muted text-center"
        style={{ fontSize: 10, letterSpacing: "0.1em", textDecoration: "none" }}
      >
        ← Back to Profile
      </Link>
    </div>
  );
}

function StatCard({ label, value, loading, highlight }: { label: string; value: number | string; loading: boolean; highlight?: boolean }) {
  return (
    <div
      className="glass rounded-xl p-4"
      style={highlight ? { border: "1px solid rgba(243,156,18,0.45)" } : undefined}
    >
      <p className="t-mono t-muted" style={{ fontSize: 8, letterSpacing: "0.16em" }}>{label}</p>
      {loading ? (
        <div className="skeleton h-7 w-20 mt-2" />
      ) : (
        <p className="t-display t-gold mt-2" style={{ fontSize: 22 }}>{value}</p>
      )}
    </div>
  );
}
