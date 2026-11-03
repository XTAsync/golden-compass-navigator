import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Transaction History — Golden Compass" },
      { name: "description", content: "Your complete log of Golden Compass deposits, withdrawals and pool investments." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Transaction History — Golden Compass" },
      { property: "og:description", content: "Your deposit, withdrawal and investment log." },
      { property: "og:url", content: "/history" },
    ],
    links: [{ rel: "canonical", href: "/history" }],
  }),
  component: HistoryPage,
});

interface TxRow {
  id: string;
  type: string | null;
  amount: number;
  status: string | null;
  created_at: string | null;
  confirmed_at: string | null;
  mpesa_reference: string | null;
  pool_id: string | null;
  investment_pools: { name: string } | null;
}

const KES = (n: number) =>
  "KES " + Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--gc-warning)",
  confirmed: "var(--gc-success)",
  failed: "var(--gc-danger)",
  cancelled: "var(--gc-danger)",
};

function HistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, type, amount, status, created_at, confirmed_at, mpesa_reference, pool_id, investment_pools(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setTxs((data as unknown as TxRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
          TRANSACTIONS
        </p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>
          Transaction History
        </h1>
      </header>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : txs.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center">
          <p className="text-3xl mb-3">📜</p>
          <p className="t-serif t-parch" style={{ fontSize: 15 }}>
            The ledger is empty.
          </p>
          <p className="t-mono t-muted mt-2" style={{ fontSize: 10 }}>
            Your transactions will be recorded here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {txs.map((tx) => {
            const label = tx.type === "deposit" ? "↓ Deposit" : tx.type === "invest" ? "→ Investment" : "↑ Withdrawal";
            const isCredit = tx.type === "deposit";
            const color = STATUS_COLOR[tx.status ?? "pending"] ?? "var(--gold-300)";
            return (
              <div key={tx.id} className="glass rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="t-display t-parch" style={{ fontSize: 14 }}>
                      {label}
                      {tx.investment_pools?.name && (
                        <span className="t-sec" style={{ fontSize: 12 }}>
                          {" · "}
                          {tx.investment_pools.name}
                        </span>
                      )}
                    </p>
                    <p className="t-mono t-muted mt-1" style={{ fontSize: 9, letterSpacing: "0.1em" }}>
                      {tx.created_at ? new Date(tx.created_at).toLocaleString("en-KE") : ""}
                    </p>
                    {tx.mpesa_reference && (
                      <p className="t-mono t-sec mt-1" style={{ fontSize: 9 }}>
                        REF: {tx.mpesa_reference}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className="t-serif"
                      style={{
                        fontSize: 15,
                        color: isCredit ? "var(--gc-success)" : tx.type === "invest" ? "var(--gold-300)" : "var(--parchment)",
                      }}
                    >
                      {isCredit ? "+" : "−"}
                      {KES(Number(tx.amount))}
                    </p>
                    <span
                      className="t-mono inline-block mt-1"
                      style={{
                        fontSize: 8,
                        letterSpacing: "0.14em",
                        color,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: `${color}1A`,
                        border: `1px solid ${color}55`,
                      }}
                    >
                      {(tx.status ?? "PENDING").toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
