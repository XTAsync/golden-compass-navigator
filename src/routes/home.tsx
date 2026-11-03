import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sparkline } from "@/components/Sparkline";
import { TiltCard } from "@/components/TiltCard";
import { NotificationBell } from "@/components/NotificationBell";
import { WithdrawModal } from "@/components/WithdrawModal";
import { useAccountSummary } from "@/hooks/useAccountSummary";
import { WalletDepositModal } from "@/components/WalletDepositModal";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Investor Dashboard — Golden Compass" },
      { name: "description", content: "Track your portfolio value, holdings, wallet balance and recent performance on Golden Compass." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Investor Dashboard — Golden Compass" },
      { property: "og:description", content: "Track your portfolio value, holdings and wallet balance." },
      { property: "og:url", content: "/home" },
    ],
    links: [{ rel: "canonical", href: "/home" }],
  }),
  component: HomePage,
});

interface InvestmentRow {
  id: string;
  pool_id: string;
  invested_amount: number | null;
  current_value: number | null;
  units_owned: number | null;
  investment_pools: {
    name: string;
    pool_type: string | null;
    current_nav: number | null;
    exit_fee_percent: number | null;
    holding_period_days: number | null;
  } | null;
}

const KES = (n: number) =>
  "KES " + n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const account = useAccountSummary();
  const [loading, setLoading] = useState(true);
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [fullName, setFullName] = useState("Investor");
  const [withdrawTarget, setWithdrawTarget] = useState<InvestmentRow | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [showDeposit, setShowDeposit] = useState(false);
  const [walletBal, setWalletBal] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: invs }, { data: profile }] = await Promise.all([
        supabase
          .from("user_investments")
          .select("id, pool_id, invested_amount, current_value, units_owned, investment_pools(name, pool_type, current_nav, exit_fee_percent, holding_period_days)")
          .eq("user_id", user.id),
        supabase.from("profiles").select("full_name, wallet_balance").eq("id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      setInvestments((invs as unknown as InvestmentRow[]) ?? []);
      if (profile?.full_name) setFullName(profile.full_name.split(" ")[0]);
      setWalletBal(Number(profile?.wallet_balance ?? 0));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, reloadTick]);

  const totalValue = investments.reduce((s, i) => s + Number(i.current_value ?? 0), 0);
  const totalInvested = investments.reduce((s, i) => s + Number(i.invested_amount ?? 0), 0);
  const gain = totalValue - totalInvested;
  const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

  // Generate a sparkline trend toward current totalValue
  const sparkData = (() => {
    if (totalValue === 0) return Array.from({ length: 12 }, (_, i) => 100 + Math.sin(i / 2) * 5);
    const start = totalInvested || totalValue * 0.95;
    const arr: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const noise = Math.sin(i * 1.7) * (totalValue * 0.015);
      arr.push(start + (totalValue - start) * t + noise);
    }
    return arr;
  })();

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      {/* Greeting */}
      <header className="flex items-center justify-between">
        <div>
          <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
            WELCOME ABOARD
          </p>
          <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>
            <span className="sr-only">Investor Dashboard — </span>{fullName}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <Link
            to="/profile"
            className="glass w-11 h-11 rounded-full flex items-center justify-center t-gold"
            style={{ fontFamily: "var(--font-display)", fontSize: 14 }}
          >
            {fullName.charAt(0).toUpperCase()}
          </Link>
        </div>
      </header>

      {/* Portfolio hero */}
      <TiltCard className="glass-gold rounded-2xl p-6">
        <div className="relative z-10">
          <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
            TOTAL PORTFOLIO VALUE
          </p>
          {loading ? (
            <div className="skeleton h-10 w-48 mt-3" />
          ) : (
            <h2
              className="t-display t-parch mt-2"
              style={{ fontSize: 34, letterSpacing: "0.02em" }}
            >
              <AnimatedNumber value={totalValue} format={KES} />
            </h2>
          )}

          <div className="mt-3 flex items-center gap-3">
            {loading ? (
              <div className="skeleton h-4 w-24" />
            ) : (
              <span
                className={gain >= 0 ? "t-success" : "t-danger"}
                style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
              >
                {gain >= 0 ? "▲" : "▼"} {KES(Math.abs(gain))}{" "}
                ({gainPct >= 0 ? "+" : ""}
                {gainPct.toFixed(2)}%)
              </span>
            )}
            <span className="t-mono t-muted" style={{ fontSize: 9 }}>
              ALL TIME
            </span>
          </div>

          <div className="mt-5">
            {loading ? (
              <div className="skeleton h-[60px] w-full" />
            ) : (
              <Sparkline data={sparkData} />
            )}
          </div>

          <div className="mt-4 glass rounded-lg p-3 flex items-center justify-between">
            <div>
              <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.14em" }}>WALLET</p>
              <p className="t-display t-gold mt-1" style={{ fontSize: 16 }}>{KES(walletBal)}</p>
            </div>
            <button
              onClick={() => setShowDeposit(true)}
              className="btn-brass"
              style={{ padding: "10px 14px", fontSize: 10 }}
              aria-label="Deposit funds into wallet"
            >
              + DEPOSIT
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Link to="/pools" className="btn-brass" style={{ padding: "12px 10px", fontSize: 11 }}>
              Invest
            </Link>
            <Link to="/trade" className="btn-brass" style={{ padding: "12px 10px", fontSize: 11 }}>
              Trade
            </Link>
            <Link
              to="/history"
              className="glass rounded-[10px] flex items-center justify-center t-gold"
              style={{ fontFamily: "var(--font-display)", letterSpacing: "0.08em", fontSize: 11, padding: "12px 10px" }}
            >
              HISTORY
            </Link>
          </div>

        </div>
      </TiltCard>

      {/* Holdings */}
      <section>
        <h2 className="t-display t-gold mb-3" style={{ fontSize: 14, letterSpacing: "0.06em" }}>
          Your Holdings
        </h2>
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton h-20 w-full rounded-xl" />
            <div className="skeleton h-20 w-full rounded-xl" />
          </div>
        ) : investments.length === 0 ? (
          <div className="glass rounded-xl p-6 text-center">
            <p className="t-serif t-parch" style={{ fontSize: 15 }}>
              Your voyage has not yet begun.
            </p>
            <p className="t-mono t-muted mt-2" style={{ fontSize: 10 }}>
              Choose a pool to set sail.
            </p>
            <Link
              to="/pools"
              className="btn-brass mt-4 inline-flex"
              style={{ padding: "10px 18px", fontSize: 10 }}
            >
              Explore Pools
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {investments.map((inv) => {
              const value = Number(inv.current_value ?? 0);
              const invested = Number(inv.invested_amount ?? 0);
              const change = value - invested;
              const changePct = invested > 0 ? (change / invested) * 100 : 0;
              return (
                <div key={inv.id} className="glass rounded-xl p-4 relative z-0">
                  <div className="relative z-10 flex items-center justify-between">
                    <div>
                      <p className="t-display t-parch" style={{ fontSize: 14 }}>
                        {inv.investment_pools?.name ?? "Pool"}
                      </p>
                      <p className="t-mono t-sec mt-1" style={{ fontSize: 9, letterSpacing: "0.14em" }}>
                        {(inv.investment_pools?.pool_type ?? "").toUpperCase()} ·{" "}
                        {Number(inv.units_owned ?? 0).toFixed(4)} UNITS
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="t-serif t-gold" style={{ fontSize: 15 }}>
                        {KES(value)}
                      </p>
                      <p
                        className={change >= 0 ? "t-success" : "t-danger"}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                      >
                        {change >= 0 ? "+" : ""}
                        {changePct.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                  {value > 0 && (
                    <button
                      onClick={() => setWithdrawTarget(inv)}
                      className="mt-3 w-full glass rounded-lg t-gold"
                      style={{
                        fontFamily: "var(--font-display)",
                        letterSpacing: "0.08em",
                        fontSize: 10,
                        padding: "8px 12px",
                      }}
                    >
                      WITHDRAW
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      {withdrawTarget && (
        <WithdrawModal
          wallet={account.wallet}
          phone={account.phone}
          holdings={account.poolHoldings}
          initialSource={withdrawTarget.pool_id}
          onClose={() => setWithdrawTarget(null)}
          onSuccess={() => { account.refresh(); setReloadTick((t) => t + 1); }}
        />
      )}
      {showDeposit && (
        <WalletDepositModal
          onClose={() => setShowDeposit(false)}
          onSuccess={() => setReloadTick((t) => t + 1)}
        />
      )}
    </div>
  );
}
