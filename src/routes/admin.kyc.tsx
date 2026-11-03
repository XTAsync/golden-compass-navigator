import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

export const Route = createFileRoute("/admin/kyc")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "KYC Queue — Admin" },
      { name: "description", content: "Review pending investor KYC submissions, approve or reject identity verification requests." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "KYC Queue — Admin" },
      { property: "og:description", content: "Internal admin queue for KYC review decisions." },
      { property: "og:url", content: "/admin/kyc" },
    ],
    links: [{ rel: "canonical", href: "/admin/kyc" }],
  }),
  component: AdminKycPage,
});

interface KycRow {
  id: string;
  user_id: string;
  national_id: string | null;
  date_of_birth: string | null;
  address: string | null;
  employment_status: string | null;
  annual_income_range: string | null;
  source_of_funds: string | null;
  status: string | null;
  created_at: string | null;
  review_notes: string | null;
}

function AdminKycPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const [rows, setRows] = useState<KycRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { full_name: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (roleLoading) return;
    if (!isAdmin) navigate({ to: "/home" });
  }, [isAdmin, roleLoading, navigate]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("kyc_records").select("*").order("created_at", { ascending: false });
    if (filter === "pending") q = q.eq("status", "pending");
    const { data } = await q;
    const list = (data as KycRow[]) ?? [];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.user_id)));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      const map: Record<string, { full_name: string }> = {};
      (profs ?? []).forEach((p) => (map[p.id] = { full_name: p.full_name }));
      setProfiles(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, filter]);

  const review = async (row: KycRow, decision: "approved" | "rejected") => {
    setBusy(row.id);
    try {
      const notes = decision === "rejected" ? prompt("Rejection reason?") || "" : "";
      await supabase
        .from("kyc_records")
        .update({ status: decision, reviewed_by: user!.id, review_notes: notes })
        .eq("id", row.id);
      await supabase.from("profiles").update({ kyc_status: decision }).eq("id", row.user_id);
      await supabase.from("audit_logs").insert({
        action: `kyc_${decision}`,
        actor_email: user!.email,
        entity_type: "kyc_record",
        entity_id: row.id,
        metadata: { user_id: row.user_id, notes },
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-5 pt-6 pb-28 anim-fade-up">
      <header className="flex items-center justify-between">
        <div>
          <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
            REVIEW QUEUE
          </p>
          <h1 className="t-display t-gold mt-1" style={{ fontSize: 20 }}>KYC Submissions</h1>
        </div>
        <Link to="/admin" className="t-mono t-muted" style={{ fontSize: 10, textDecoration: "none" }}>← Back</Link>
      </header>

      <div className="flex gap-2">
        {(["pending", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="t-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              padding: "8px 14px",
              borderRadius: 999,
              border: filter === f ? "1px solid var(--gold-300)" : "1px solid rgba(255,255,255,0.1)",
              background: filter === f ? "rgba(201,168,76,0.12)" : "transparent",
              color: filter === f ? "var(--gold-300)" : "var(--parchment)",
              cursor: "pointer",
            }}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-44 w-full rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center">
          <p className="t-serif t-parch" style={{ fontSize: 14 }}>Queue empty.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="glass rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="t-display t-parch" style={{ fontSize: 14 }}>
                    {profiles[r.user_id]?.full_name || "—"}
                  </p>
                  <p className="t-mono t-muted mt-1" style={{ fontSize: 9 }}>
                    {r.created_at ? new Date(r.created_at).toLocaleString("en-KE") : ""}
                  </p>
                </div>
                <span
                  className="t-mono"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.14em",
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: r.status === "approved" ? "rgba(46,204,113,0.15)" :
                      r.status === "rejected" ? "rgba(231,76,60,0.15)" : "rgba(52,152,219,0.15)",
                    color: r.status === "approved" ? "var(--gc-success)" :
                      r.status === "rejected" ? "var(--gc-danger)" : "var(--gc-info)",
                  }}
                >
                  {(r.status ?? "").toUpperCase()}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 t-mono t-sec" style={{ fontSize: 10 }}>
                <div>ID: <span className="t-parch">{r.national_id}</span></div>
                <div>DOB: <span className="t-parch">{r.date_of_birth}</span></div>
                <div className="col-span-2">Address: <span className="t-parch">{r.address}</span></div>
                <div>Employment: <span className="t-parch">{r.employment_status}</span></div>
                <div>Income: <span className="t-parch">{r.annual_income_range}</span></div>
                <div>Source: <span className="t-parch">{r.source_of_funds}</span></div>
              </div>

              {r.review_notes && (
                <p className="t-mono t-muted mt-2" style={{ fontSize: 10, fontStyle: "italic" }}>
                  Notes: {r.review_notes}
                </p>
              )}

              {r.status === "pending" && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => review(r, "approved")}
                    disabled={busy === r.id}
                    className="btn-brass"
                    style={{ padding: "10px", fontSize: 11 }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => review(r, "rejected")}
                    disabled={busy === r.id}
                    className="t-mono"
                    style={{
                      padding: "10px",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      borderRadius: 10,
                      border: "1px solid rgba(231,76,60,0.5)",
                      background: "rgba(231,76,60,0.1)",
                      color: "var(--gc-danger)",
                      cursor: "pointer",
                    }}
                  >
                    ✕ Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
