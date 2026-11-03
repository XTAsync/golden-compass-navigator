import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { StatusChip } from "@/components/StatusChip";

export const Route = createFileRoute("/admin/transactions")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Transactions — Admin" },
      { name: "description", content: "Admin ledger of all deposits and withdrawals; approve or reject pending withdrawal requests." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Transactions — Admin" },
      { property: "og:description", content: "Internal admin ledger and withdrawal approval queue." },
      { property: "og:url", content: "/admin/transactions" },
    ],
    links: [{ rel: "canonical", href: "/admin/transactions" }],
  }),
  component: AdminTxPage,
});

interface TxRow {
  id: string;
  user_id: string;
  type: string | null;
  amount: number;
  status: string | null;
  created_at: string | null;
  mpesa_reference: string | null;
  gross_amount: number | null;
  fee_amount: number | null;
  source: string | null;
  payout_phone: string | null;
  failure_reason: string | null;
  mpesa_checkout_id: string | null;
  investment_pools: { name: string } | null;
}

const KES = (n: number) => "KES " + Number(n).toLocaleString("en-KE", { maximumFractionDigits: 2 });

/** Start of today in Nairobi (UTC+3, no daylight saving), as epoch ms. */
function nairobiDayStart(): number {
  const now = Date.now() + 3 * 3_600_000;
  return Math.floor(now / 86_400_000) * 86_400_000 - 3 * 3_600_000;
}

function AdminTxPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (roleLoading) return;
    if (!isAdmin) navigate({ to: "/home" });
  }, [isAdmin, roleLoading, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, user_id, type, amount, status, created_at, mpesa_reference, gross_amount, fee_amount, source, payout_phone, failure_reason, mpesa_checkout_id, investment_pools(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      const list = (data as unknown as TxRow[]) ?? [];
      setRows(list);
      const ids = Array.from(new Set(list.map((r) => r.user_id)));
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        const m: Record<string, string> = {};
        (profs ?? []).forEach((p) => (m[p.id] = p.full_name));
        setProfiles(m);
      }
      setLoading(false);
    })();
  }, [isAdmin, reloadTick]);

  const resolveDeposit = async (txId: string) => {
    const receipt = (receipts[txId] ?? "").trim();
    if (!receipt) return;
    setBusyId(txId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error("Session expired"); return; }
      const res = await fetch("/api/admin-resolve-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transaction_id: txId, receipt }),
      });
      const data = await res.json();
      if (!res.ok || data.error) toast.error(data.error || "Failed");
      else { toast.success("Deposit resolved. The wallet was credited."); setReloadTick((t) => t + 1); }
    } finally {
      setBusyId(null);
    }
  };

  const handleAction = async (txId: string, action: "approve" | "reject") => {
    setBusyId(txId);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Session expired");
        return;
      }
      const res = await fetch("/api/withdraw-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transaction_id: txId, action }),
      });
      const data = await res.json();
      if (!res.ok || data.error) toast.error(data.error || "Failed");
      else {
        toast.success(action === "approve" ? "Withdrawal approved. Payout sent." : "Withdrawal rejected. The money went back to the user.");
        setConfirmId(null);
        setReloadTick((t) => t + 1);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-5 pt-6 pb-28 anim-fade-up">
      <header className="flex items-center justify-between">
        <div>
          <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>TRANSACTIONS</p>
          <h1 className="t-display t-gold mt-1" style={{ fontSize: 20 }}>All Transactions</h1>
        </div>
        <Link to="/admin" className="t-mono t-muted" style={{ fontSize: 10, textDecoration: "none" }}>← Back</Link>
      </header>

      {(() => {
        const held = rows.filter((r) => r.type === "deposit" && r.status === "pending" && r.failure_reason);
        if (held.length === 0) return null;
        return (
          <section className="glass-gold rounded-xl p-4" aria-label="Needs review">
            <h2 className="t-display t-gold" style={{ fontSize: 16 }}>Needs review ({held.length})</h2>
            <p className="t-label mt-1">Paid deposits we could not match on their own. Nothing is credited until you act.</p>
            <div className="mt-3 space-y-3">
              {held.map((r) => (
                <div key={r.id} className="glass rounded-lg p-3">
                  <p className="t-serif t-parch" style={{ fontSize: 14 }}>{profiles[r.user_id] || "—"} · {KES(Number(r.amount))}</p>
                  <p className="t-label mt-1">
                    {r.failure_reason === "missing_receipt" ? "Paid, but M-Pesa sent no receipt. Find it on the M-Pesa statement."
                      : r.failure_reason === "amount_mismatch" ? "The amount paid did not match. Check the statement and contact the user."
                      : r.failure_reason === "duplicate_receipt" ? "This receipt was already used. Check for a duplicate."
                      : `Reason: ${r.failure_reason}`}
                  </p>
                  {r.failure_reason === "missing_receipt" && (
                    <div className="mt-2 flex gap-2">
                      <input aria-label="M-Pesa receipt" placeholder="Receipt, e.g. QGH7XK2LMN" value={receipts[r.id] ?? ""}
                        onChange={(e) => setReceipts((m) => ({ ...m, [r.id]: e.target.value }))}
                        className="glass rounded-lg px-3 py-2 t-mono t-parch flex-1 min-w-0" style={{ fontSize: 14 }} />
                      <button onClick={() => resolveDeposit(r.id)} disabled={busyId === r.id || !(receipts[r.id] ?? "").trim()}
                        className="btn-brass tap44" style={{ fontSize: 14, opacity: busyId === r.id || !(receipts[r.id] ?? "").trim() ? 0.5 : 1 }}>
                        Credit
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-16 w-full rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center">
          <p className="t-serif t-parch" style={{ fontSize: 14 }}>No transactions yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((tx) => {
            const isDep = tx.type === "deposit";
            const usedToday = rows
              .filter((r) => r.user_id === tx.user_id && r.type === "withdrawal" && ["pending", "processing", "confirmed"].includes(r.status ?? "") && r.created_at && new Date(r.created_at).getTime() >= nairobiDayStart())
              .reduce((sum, r) => sum + Number(r.gross_amount ?? r.amount), 0);
            const showActions = tx.type === "withdrawal" && tx.status === "pending";
            return (
              <div key={tx.id} className="glass rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="t-serif t-parch truncate" style={{ fontSize: 13 }}>
                      {isDep ? "↓" : "↑"} {profiles[tx.user_id] || "—"}
                    </p>
                    <p className="t-mono t-muted mt-0.5" style={{ fontSize: 9 }}>
                      {tx.created_at ? new Date(tx.created_at).toLocaleString("en-KE") : ""}
                      {tx.investment_pools?.name ? ` · ${tx.investment_pools.name}` : ""}
                    </p>
                  </div>
                  <div className="text-right ml-2">
                    <p className="t-serif t-gold" style={{ fontSize: 13 }}>{KES(Number(tx.amount))}</p>
                    <StatusChip status={tx.status} />
                  </div>
                </div>
                {showActions && (
                  <div className="mt-3">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 t-label">
                      <dt>Pay out</dt><dd className="t-parch" style={{ fontSize: 14 }}>{KES(Number(tx.amount))}</dd>
                      <dt>To phone</dt><dd className="t-parch" style={{ fontSize: 14 }}>{tx.payout_phone ?? "missing"}</dd>
                      <dt>From</dt><dd className="t-parch" style={{ fontSize: 14 }}>{tx.source === "wallet" ? "Wallet" : (tx.investment_pools?.name ?? "Pool")}</dd>
                      <dt>Fee</dt><dd className="t-parch" style={{ fontSize: 14 }}>{KES(Number(tx.fee_amount ?? 0))} (gross {KES(Number(tx.gross_amount ?? tx.amount))})</dd>
                      <dt>This user today</dt><dd className="t-parch" style={{ fontSize: 14 }}>{KES(usedToday)} requested</dd>
                    </dl>
                    {confirmId === tx.id ? (
                      <div className="mt-3 glass rounded-lg p-3" role="alertdialog" aria-label="Confirm payout">
                        <p className="t-status t-gold">Send {KES(Number(tx.amount))} to {tx.payout_phone}? This pays real money and cannot be undone.</p>
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          <button onClick={() => handleAction(tx.id, "approve")} disabled={busyId === tx.id} className="btn-brass tap44" style={{ fontSize: 14, opacity: busyId === tx.id ? 0.5 : 1 }}>
                            {busyId === tx.id ? "Sending…" : "Yes, pay"}
                          </button>
                          <button onClick={() => setConfirmId(null)} disabled={busyId === tx.id} className="glass rounded-lg t-gold tap44" style={{ fontSize: 14 }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <button onClick={() => setConfirmId(tx.id)} disabled={busyId === tx.id} className="btn-brass tap44" style={{ fontSize: 14 }}>Approve</button>
                        <button onClick={() => handleAction(tx.id, "reject")} disabled={busyId === tx.id} className="glass rounded-lg t-danger tap44" style={{ fontSize: 14 }}>Reject</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
