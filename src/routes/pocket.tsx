import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAccountSummary, KES } from "@/hooks/useAccountSummary";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { TiltCard } from "@/components/TiltCard";
import { WalletDepositModal } from "@/components/WalletDepositModal";
import { WithdrawModal } from "@/components/WithdrawModal";
import { StatusChip } from "@/components/StatusChip";
import { useMoneyConfig } from "@/hooks/useMoneyConfig";
import { ArrowDownLeft, ArrowUpRight, Smartphone, Receipt, PiggyBank } from "lucide-react";

export const Route = createFileRoute("/pocket")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Pocket Access — Wallet | Golden Compass" },
      {
        name: "description",
        content: "Manage your Golden Compass wallet: balance, M-Pesa deposits, withdrawals and recent money activity.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Pocket Access — Wallet | Golden Compass" },
      { property: "og:description", content: "Wallet balance, deposits, withdrawals and money activity." },
      { property: "og:url", content: "/pocket" },
    ],
    links: [{ rel: "canonical", href: "/pocket" }],
  }),
  component: PocketPage,
});

interface TxRow {
  id: string;
  type: string | null;
  amount: number;
  status: string | null;
  created_at: string | null;
  mpesa_reference: string | null;
}

function PocketPage() {
  const { user, loading: authLoading } = useAuth();
  const s = useAccountSummary();
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const money = useMoneyConfig({}, !!user);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, type, amount, status, created_at, mpesa_reference")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(6);
      if (cancelled) return;
      setTxs((data as TxRow[]) ?? []);
      setLoadingTx(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, s.loading]);

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" />;

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
          POCKET ACCESS
        </p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>
          Your Money
        </h1>
      </header>

      {/* Balance */}
      <TiltCard className="glass-gold rounded-[22px] p-6" max={5}>
        <div className="relative z-10">
          <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
            WALLET BALANCE
          </p>
          {s.loading ? (
            <div className="skeleton h-9 w-48 mt-3 rounded-lg" />
          ) : (
            <h2 className="t-display t-parch mt-2" style={{ fontSize: 30 }}>
              <AnimatedNumber value={s.wallet} format={KES} />
            </h2>
          )}
          <p className="t-label mt-1">
            AVAILABLE TO INVEST OR TRADE
          </p>

          {/* Status lines appear only when there is something to say (design D3). */}
          <div className="mt-2 space-y-1" aria-live="polite">
            {money.data?.paused.withdrawals && (
              <p className="t-label" style={{ color: "#F5B041" }}>Withdrawals are paused for a moment. Your money is safe.</p>
            )}
            {(money.data?.pending.withdrawals_pending ?? 0) > 0 && (
              <p className="t-label">
                {KES(money.data!.pending.withdrawals_pending)} on its way to your M-Pesa. Usually within 24 hours.
              </p>
            )}
            {(money.data?.pending.deposits_pending ?? 0) > 0 && (
              <p className="t-label">
                {KES(money.data!.pending.deposits_pending)} deposit still being confirmed.
              </p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={() => setShowDeposit(true)}
              className="btn-brass flex items-center justify-center gap-1.5"
              style={{ padding: "13px 10px", fontSize: 11 }}
            >
              <ArrowDownLeft size={15} /> DEPOSIT
            </button>
            <button
              onClick={() => setShowWithdraw(true)}
              className="glass rounded-[10px] flex items-center justify-center gap-1.5 t-gold border-none cursor-pointer"
              style={{ fontFamily: "var(--font-display)", letterSpacing: "0.08em", fontSize: 11, padding: "13px 10px" }}
            >
              <ArrowUpRight size={15} /> WITHDRAW
            </button>
          </div>

        </div>
      </TiltCard>

      {/* Allocation */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/pools" className="glass rounded-2xl p-4" style={{ textDecoration: "none" }}>
          <PiggyBank size={18} className="t-gold" />
          <p className="t-mono t-sec mt-2" style={{ fontSize: 8, letterSpacing: "0.14em" }}>
            IN POOLS
          </p>
          <p className="t-serif t-parch mt-1" style={{ fontSize: 14 }}>
            {KES(s.poolsValue)}
          </p>
        </Link>
        <Link to="/portfolio" className="glass rounded-2xl p-4" style={{ textDecoration: "none" }}>
          <Receipt size={18} className="t-gold" />
          <p className="t-mono t-sec mt-2" style={{ fontSize: 8, letterSpacing: "0.14em" }}>
            IN POSITIONS
          </p>
          <p className="t-serif t-parch mt-1" style={{ fontSize: 14 }}>
            {KES(s.stocksInvested)}
          </p>
        </Link>
      </div>

      {/* Funding method */}
      <section className="glass rounded-2xl p-4">
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.16em" }}>
          FUNDING METHOD
        </p>
        <div className="mt-3 flex items-center gap-3">
          <span
            className="flex items-center justify-center rounded-xl shrink-0"
            style={{ width: 38, height: 38, color: "var(--gc-success)", background: "rgba(46,204,113,0.10)", border: "1px solid rgba(46,204,113,0.28)" }}
          >
            <Smartphone size={18} strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <p className="t-serif t-parch" style={{ fontSize: 14 }}>
              M-Pesa STK Push
            </p>
            <p className="t-mono t-muted" style={{ fontSize: 9 }}>
              Enter your phone number at deposit — no card required.
            </p>
          </div>
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="t-display t-gold" style={{ fontSize: 14, letterSpacing: "0.06em" }}>
            Recent Activity
          </h2>
          <Link to="/history" className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.12em", textDecoration: "none" }}>
            VIEW ALL ›
          </Link>
        </div>
        {loadingTx ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : txs.length === 0 ? (
          <div className="glass rounded-xl p-6 text-center">
            <p className="t-serif t-parch" style={{ fontSize: 14 }}>
              No money has moved yet.
            </p>
            <p className="t-mono t-muted mt-1" style={{ fontSize: 10 }}>
              Your deposit and withdrawal activity will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {txs.map((tx) => {
              const isCredit = tx.type === "deposit";
              return (
                <div key={tx.id} className="glass rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="t-serif t-parch truncate" style={{ fontSize: 13 }}>
                      {tx.type === "deposit" ? "Deposit" : tx.type === "invest" ? "Investment" : "Withdrawal"}
                    </p>
                    <p className="t-mono t-muted mt-1" style={{ fontSize: 9 }}>
                      {tx.created_at ? new Date(tx.created_at).toLocaleString("en-KE") : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="t-serif" style={{ fontSize: 13, color: isCredit ? "var(--gc-success)" : "var(--parchment)" }}>
                      {isCredit ? "+" : "−"}
                      {KES(Number(tx.amount))}
                    </p>
                    <StatusChip status={tx.status} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showDeposit && <WalletDepositModal phone={s.phone} onClose={() => setShowDeposit(false)} onSuccess={s.refresh} />}
      {showWithdraw && (
        <WithdrawModal
          wallet={s.wallet}
          phone={s.phone}
          holdings={s.poolHoldings}
          onClose={() => setShowWithdraw(false)}
          onSuccess={s.refresh}
        />
      )}
    </div>
  );
}
