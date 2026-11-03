import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useAccountSummary, KES } from "@/hooks/useAccountSummary";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { TiltCard } from "@/components/TiltCard";
import { NotificationBell } from "@/components/NotificationBell";
import { Wallet, LineChart, UserCog, LayoutGrid, Star, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/command")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Command Center — Golden Compass" },
      {
        name: "description",
        content: "Your Golden Compass control panel: account status, pocket access, market view, quick access and account centre.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Command Center — Golden Compass" },
      { property: "og:description", content: "One control panel for wallet, markets, tools and account." },
      { property: "og:url", content: "/command" },
    ],
    links: [{ rel: "canonical", href: "/command" }],
  }),
  component: CommandCenter,
});

const ACTIONS = [
  {
    to: "/pocket" as const,
    Icon: Wallet,
    title: "Pocket Access",
    caption: "Wallet, deposits & withdrawals",
  },
  {
    to: "/markets" as const,
    Icon: LineChart,
    title: "Market View",
    caption: "Prices, charts & watchlist",
  },
  {
    to: "/account" as const,
    Icon: UserCog,
    title: "Acc Centre",
    caption: "Profile, security & settings",
  },
  {
    to: "/quick" as const,
    Icon: LayoutGrid,
    title: "Quick Access",
    caption: "Shortcuts & utilities",
  },
];

function CommandCenter() {
  const { user, loading: authLoading } = useAuth();
  const s = useAccountSummary();

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" />;

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
            COMMAND CENTER
          </p>
          <h1 className="t-display t-gold mt-1 truncate" style={{ fontSize: 20 }}>
            Welcome, {s.firstName}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <NotificationBell />
          <Link
            to="/pools"
            aria-label="View pool terms"
            className="glass flex items-center gap-1.5 rounded-full"
            style={{ padding: "9px 13px", textDecoration: "none", color: "var(--gold-300)" }}
          >
            <Star size={15} strokeWidth={1.8} />
            <span className="t-mono" style={{ fontSize: 9, letterSpacing: "0.12em" }}>
              POOLS
            </span>
          </Link>
        </div>
      </header>

      {/* ACC STATUS */}
      <TiltCard className="glass-gold rounded-[22px] p-6" max={5}>
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
              ACC STATUS
            </p>
            <span
              className="t-mono"
              style={{
                fontSize: 8,
                letterSpacing: "0.14em",
                padding: "3px 8px",
                borderRadius: 999,
                color: s.kycStatus === "approved" ? "var(--gc-success)" : "var(--gc-warning)",
                border: `1px solid ${s.kycStatus === "approved" ? "rgba(46,204,113,0.4)" : "rgba(243,156,18,0.4)"}`,
                background: s.kycStatus === "approved" ? "rgba(46,204,113,0.10)" : "rgba(243,156,18,0.10)",
              }}
            >
              {s.kycStatus === "approved" ? "VERIFIED" : s.kycStatus.replace("_", " ").toUpperCase()}
            </span>
          </div>

          {s.loading ? (
            <div className="skeleton h-10 w-56 mt-3 rounded-lg" />
          ) : (
            <h2 className="t-display t-parch mt-2" style={{ fontSize: 32, letterSpacing: "0.02em" }}>
              <AnimatedNumber value={s.totalValue} format={KES} />
            </h2>
          )}
          <p className="t-mono t-muted mt-1" style={{ fontSize: 9, letterSpacing: "0.14em" }}>
            NET ACCOUNT VALUE · WALLET + HOLDINGS
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "WALLET", value: KES(s.wallet), tone: "var(--gold-300)" },
              { label: "INVESTED", value: KES(s.invested), tone: "var(--parchment)" },
              {
                label: "P / L",
                value: `${s.gain >= 0 ? "+" : ""}${s.gainPct.toFixed(2)}%`,
                tone: s.gain >= 0 ? "var(--gc-success)" : "var(--gc-danger)",
              },
            ].map((m) => (
              <div key={m.label} className="glass rounded-xl" style={{ padding: "10px 10px" }}>
                <p className="t-mono t-sec" style={{ fontSize: 8, letterSpacing: "0.14em" }}>
                  {m.label}
                </p>
                <p
                  className="t-serif mt-1"
                  style={{ fontSize: 12, color: m.tone, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {m.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Link to="/trade" className="btn-brass flex-1 text-center" style={{ padding: "12px 10px", fontSize: 11 }}>
              Trade
            </Link>
            <Link to="/pools" className="btn-brass flex-1 text-center" style={{ padding: "12px 10px", fontSize: 11 }}>
              Invest
            </Link>
            <Link
              to="/portfolio"
              className="glass rounded-[10px] flex-1 flex items-center justify-center gap-1 t-gold"
              style={{ fontFamily: "var(--font-display)", letterSpacing: "0.08em", fontSize: 11, padding: "12px 10px", textDecoration: "none" }}
            >
              PORTFOLIO <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>
      </TiltCard>

      {/* FOUR ACTIONS */}
      <div className="grid grid-cols-2 gap-3">
        {ACTIONS.map(({ to, Icon, title, caption }) => (
          <Link
            key={to}
            to={to}
            className="glass rounded-[20px] flex flex-col justify-between spatial-tilt"
            style={{ padding: 16, minHeight: 132, textDecoration: "none" }}
          >
            <span
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: 42,
                height: 42,
                color: "var(--gold-200)",
                background: "linear-gradient(150deg, rgba(201,168,76,0.22), rgba(201,168,76,0.04))",
                border: "1px solid rgba(201,168,76,0.28)",
              }}
            >
              <Icon size={20} strokeWidth={1.7} />
            </span>
            <div className="mt-3">
              <p className="t-display t-parch" style={{ fontSize: 14 }}>
                {title}
              </p>
              <p className="t-mono t-muted mt-1" style={{ fontSize: 9, lineHeight: 1.5 }}>
                {caption}
              </p>
            </div>
          </Link>
        ))}
      </div>

      <p className="t-mono t-muted text-center" style={{ fontSize: 9, letterSpacing: "0.12em" }}>
        SIMULATED TRADING — NOT REAL MONEY MARKETS
      </p>
    </div>
  );
}
