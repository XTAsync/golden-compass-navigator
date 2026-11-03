import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import {
  PieChart, History, Compass, Bell, Eye, Receipt, LifeBuoy, Star, ShieldCheck, Anchor, LogOut, CandlestickChart, Settings, Shield,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/quick")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Quick Access — Golden Compass" },
      { name: "description", content: "Launch any Golden Compass tool fast: portfolio, history, GC AI, watchlist, orders, help and security." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Quick Access — Golden Compass" },
      { property: "og:description", content: "Shortcuts to every Golden Compass tool." },
      { property: "og:url", content: "/quick" },
    ],
    links: [{ rel: "canonical", href: "/quick" }],
  }),
  component: QuickAccess,
});

type Item = { to: string; Icon: LucideIcon; label: string; feature?: boolean };

const ITEMS: Item[] = [
  { to: "/navigator", Icon: Compass, label: "GC AI", feature: true },
  { to: "/portfolio", Icon: PieChart, label: "Portfolio" },
  { to: "/history", Icon: History, label: "History" },
  { to: "/trade", Icon: CandlestickChart, label: "Trade" },
  { to: "/trade", Icon: Eye, label: "Watchlist" },
  { to: "/orders", Icon: Receipt, label: "Orders" },
  { to: "/pools", Icon: Anchor, label: "Pools" },
  { to: "/account", Icon: Bell, label: "Alerts" },
  { to: "/kyc", Icon: ShieldCheck, label: "Verify" },
  { to: "/account", Icon: Settings, label: "Settings" },
  { to: "/guides/dividend-tracking", Icon: LifeBuoy, label: "Help" },
];

function QuickAccess() {
  const { user, loading, signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;

  const items = isAdmin ? [...ITEMS, { to: "/admin", Icon: Shield, label: "Admin" }] : ITEMS;

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>QUICK ACCESS</p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>The Launcher</h1>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {items.map(({ to, Icon, label, feature }) => (
          <Link
            key={label}
            to={to}
            className={`${feature ? "glass-gold" : "glass"} rounded-[18px] flex flex-col items-center justify-center gap-2`}
            style={{ aspectRatio: "1 / 1", textDecoration: "none" }}
          >
            <span
              className="relative z-10 flex items-center justify-center rounded-2xl"
              style={{
                width: 44, height: 44, color: "var(--gold-200)",
                background: "linear-gradient(150deg, rgba(201,168,76,0.22), rgba(201,168,76,0.04))",
                border: "1px solid rgba(201,168,76,0.28)",
              }}
            >
              <Icon size={20} strokeWidth={1.7} />
            </span>
            <span className="relative z-10 t-mono t-parch" style={{ fontSize: 10, letterSpacing: "0.08em" }}>
              {label.toUpperCase()}
            </span>
          </Link>
        ))}
      </div>

      <button
        onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
        className="glass rounded-2xl flex items-center justify-center gap-2 border-none cursor-pointer"
        style={{ padding: "15px", color: "var(--gc-danger)", fontFamily: "var(--font-display)", fontSize: 12, letterSpacing: "0.08em" }}
      >
        <LogOut size={16} /> LOG OUT
      </button>
    </div>
  );
}
