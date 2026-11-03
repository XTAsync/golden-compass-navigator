import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Portfolio — Golden Compass" },
      {
        name: "description",
        content:
          "Your complete Golden Compass portfolio: pool holdings, stock positions, total value and unrealised gain or loss.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Portfolio — Golden Compass" },
      { property: "og:description", content: "Pool holdings and stock positions in one view." },
      { property: "og:url", content: "/portfolio" },
    ],
    links: [{ rel: "canonical", href: "/portfolio" }],
  }),
  component: PortfolioPage,
});

interface Holding {
  key: string;
  kind: "pool" | "stock";
  name: string;
  sub: string;
  invested: number;
  value: number;
}

const fmt = (n: number) =>
  n.toLocaleString("en-KE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function PortfolioPage() {
  const { user, loading: authLoading } = useAuth();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [wallet, setWallet] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: profile }, { data: pools }, { data: stocks }] = await Promise.all([
        supabase.from("profiles").select("wallet_balance").eq("id", user.id).maybeSingle(),
        supabase
          .from("user_investments")
          .select("id, invested_amount, current_value, units_owned, investment_pools(name, pool_type)")
          .eq("user_id", user.id),
        supabase
          .from("stock_holdings")
          .select("id, symbol, exchange, quantity, avg_price, invested_amount, currency")
          .eq("user_id", user.id),
      ]);

      const poolRows: Holding[] = (pools ?? [])
        .filter((p) => Number(p.units_owned ?? 0) > 0 || Number(p.invested_amount ?? 0) > 0)
        .map((p) => ({
          key: `pool-${p.id}`,
          kind: "pool" as const,
          name: (p.investment_pools as { name?: string } | null)?.name ?? "Pool",
          sub: `${Number(p.units_owned ?? 0).toFixed(4)} units`,
          invested: Number(p.invested_amount ?? 0),
          value: Number(p.current_value ?? 0),
        }));

      const stockRows: Holding[] = await Promise.all(
        (stocks ?? [])
          .filter((s) => Number(s.quantity ?? 0) > 0)
          .map(async (s) => {
            let price = Number(s.avg_price ?? 0);
            try {
              const res = await fetch(
                `/api/quote?symbol=${encodeURIComponent(s.symbol)}&exchange=${encodeURIComponent(s.exchange)}`,
              );
              if (res.ok) {
                const q = (await res.json()) as { price: number };
                if (q?.price) price = Number(q.price);
              }
            } catch {
              /* fall back to average cost */
            }
            return {
              key: `stock-${s.id}`,
              kind: "stock" as const,
              name: s.symbol,
              sub: `${Number(s.quantity)} shares · ${s.exchange}`,
              invested: Number(s.invested_amount ?? 0),
              value: Number(s.quantity ?? 0) * price,
            };
          }),
      );

      if (cancelled) return;
      setWallet(Number(profile?.wallet_balance ?? 0));
      setHoldings([...poolRows, ...stockRows]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" />;

  const totalInvested = holdings.reduce((s, h) => s + h.invested, 0);
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const pnl = totalValue - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
  const up = pnl >= 0;

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
          ACCOUNT HOLDINGS
        </p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>
          Portfolio
        </h1>
        <p className="t-serif t-sec mt-2" style={{ fontSize: 13, fontStyle: "italic" }}>
          Recorded pool holdings and stock positions in one place.
        </p>
      </header>

      {loading ? (
        <>
          <div className="skeleton h-36 w-full rounded-2xl" />
          <div className="skeleton h-24 w-full rounded-2xl" />
        </>
      ) : (
        <>
          <div className="glass-gold rounded-2xl p-5 text-center">
            <p className="t-mono t-muted" style={{ fontSize: 9, letterSpacing: "0.16em" }}>
              TOTAL PORTFOLIO VALUE
            </p>
            <p className="t-display t-gold mt-2" style={{ fontSize: 30 }}>
              KES {fmt(totalValue)}
            </p>
            <p
              className="t-mono mt-2"
              style={{ fontSize: 12, color: up ? "var(--gc-success)" : "var(--gc-danger)" }}
            >
              {up ? "▲" : "▼"} KES {fmt(Math.abs(pnl))} ({up ? "+" : "-"}
              {Math.abs(pnlPct).toFixed(2)}%)
            </p>
            <div
              className="flex justify-between mt-4 pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex-1 text-center">
                <p className="t-mono t-muted" style={{ fontSize: 9 }}>INVESTED</p>
                <p className="t-serif t-parch" style={{ fontSize: 15 }}>KES {fmt(totalInvested)}</p>
              </div>
              <div className="flex-1 text-center">
                <p className="t-mono t-muted" style={{ fontSize: 9 }}>WALLET</p>
                <p className="t-serif t-parch" style={{ fontSize: 15 }}>KES {fmt(wallet)}</p>
              </div>
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
              HOLDINGS ({holdings.length})
            </h2>

            {holdings.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center">
                <p className="text-3xl mb-3">🗺️</p>
                <p className="t-serif t-parch" style={{ fontSize: 15 }}>
                  No holdings yet.
                </p>
                <p className="t-mono t-muted mt-2" style={{ fontSize: 10 }}>
                  Your settled holdings will appear here.
                </p>
                <div className="flex gap-2 justify-center mt-4">
                  <Link to="/pools" className="btn-brass" style={{ padding: "10px 18px", fontSize: 11, textDecoration: "none" }}>
                    Pools
                  </Link>
                  <Link to="/trade" className="btn-brass" style={{ padding: "10px 18px", fontSize: 11, textDecoration: "none" }}>
                    📈 Trade
                  </Link>
                </div>
              </div>
            ) : (
              holdings.map((h) => {
                const d = h.value - h.invested;
                const dPct = h.invested > 0 ? (d / h.invested) * 100 : 0;
                const good = d >= 0;
                return (
                  <div key={h.key} className="glass rounded-2xl p-4 flex items-center justify-between">
                    <div style={{ minWidth: 0 }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 14 }}>{h.kind === "pool" ? "⚓" : "📈"}</span>
                        <span className="t-display t-parch truncate" style={{ fontSize: 15 }}>
                          {h.name}
                        </span>
                      </div>
                      <p className="t-mono t-muted mt-1" style={{ fontSize: 9 }}>
                        {h.sub} · cost KES {fmt(h.invested)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="t-serif t-parch" style={{ fontSize: 15 }}>KES {fmt(h.value)}</p>
                      <p
                        className="t-mono"
                        style={{ fontSize: 10, color: good ? "var(--gc-success)" : "var(--gc-danger)" }}
                      >
                        {good ? "+" : "-"}
                        {fmt(Math.abs(d))} ({good ? "+" : "-"}
                        {Math.abs(dPct).toFixed(2)}%)
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <Link
            to="/orders"
            className="glass rounded-2xl px-5 py-4 flex items-center justify-between"
            style={{ textDecoration: "none" }}
          >
            <span className="t-serif t-parch" style={{ fontSize: 14 }}>🧾 Order History</span>
            <span className="t-gold" style={{ fontSize: 14 }}>›</span>
          </Link>
        </>
      )}
    </div>
  );
}
