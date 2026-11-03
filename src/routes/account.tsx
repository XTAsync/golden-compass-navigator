import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useAccountSummary } from "@/hooks/useAccountSummary";
import {
  User, ShieldCheck, KeyRound, Bell, FileText, Lock, AlertTriangle, LogOut, ChevronRight, Shield, Landmark,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Account Centre — Golden Compass" },
      { name: "description", content: "Manage your Golden Compass profile, verification, security, password, notifications and privacy." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Account Centre — Golden Compass" },
      { property: "og:description", content: "Profile, security, notifications and privacy settings." },
      { property: "og:url", content: "/account" },
    ],
    links: [{ rel: "canonical", href: "/account" }],
  }),
  component: AccountCentre,
});

type Row = { to: string; Icon: LucideIcon; label: string; hint?: string };

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="glass rounded-2xl overflow-hidden">
      <p className="t-mono t-muted px-5 pt-4 pb-2" style={{ fontSize: 9, letterSpacing: "0.16em" }}>{title}</p>
      {rows.map(({ to, Icon, label, hint }) => (
        <Link
          key={label}
          to={to}
          className="flex items-center gap-3 px-5 py-4 border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)", textDecoration: "none", minHeight: 56 }}
        >
          <Icon size={18} strokeWidth={1.7} className="t-gold shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="t-serif t-parch block" style={{ fontSize: 14 }}>{label}</span>
            {hint && <span className="t-mono t-muted block" style={{ fontSize: 9 }}>{hint}</span>}
          </span>
          <ChevronRight size={16} className="t-sec shrink-0" />
        </Link>
      ))}
    </section>
  );
}

function AccountCentre() {
  const { user, loading, signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const s = useAccountSummary();
  const navigate = useNavigate();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;

  const verified = s.kycStatus === "approved";

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>ACCOUNT CENTRE</p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>Settings</h1>
      </header>

      <div className="glass-gold rounded-2xl p-5 flex items-center gap-4">
        <div
          className="relative z-10 w-14 h-14 rounded-full flex items-center justify-center t-display t-gold shrink-0"
          style={{ fontSize: 20, background: "radial-gradient(circle at 30% 30%, rgba(201,168,76,0.3), transparent 70%)", border: "1px solid rgba(201,168,76,0.4)" }}
        >
          {s.fullName.charAt(0).toUpperCase()}
        </div>
        <div className="relative z-10 min-w-0">
          <p className="t-display t-parch truncate" style={{ fontSize: 16 }}>{s.fullName}</p>
          <p className="t-mono t-muted truncate" style={{ fontSize: 10 }}>{user.email}</p>
          <p className="t-mono mt-1" style={{ fontSize: 9, letterSpacing: "0.14em", color: verified ? "var(--gc-success)" : "var(--gc-warning)" }}>
            {verified ? "VERIFIED" : "VERIFICATION " + s.kycStatus.replace("_", " ").toUpperCase()}
          </p>
        </div>
      </div>

      <Group title="PROFILE" rows={[
        { to: "/profile", Icon: User, label: "Account information", hint: "Name, phone, membership" },
        { to: "/kyc", Icon: ShieldCheck, label: "Identity verification", hint: verified ? "Completed" : "Required for withdrawals" },
        { to: "/trade", Icon: Landmark, label: "Linked brokerage accounts" },
      ]} />

      <Group title="SECURITY" rows={[
        { to: "/forgot-password", Icon: KeyRound, label: "Change password", hint: "Reset via email link" },
        { to: "/profile", Icon: Lock, label: "Authentication", hint: "Sign-in & session" },
      ]} />

      <Group title="PREFERENCES" rows={[
        { to: "/trade", Icon: Bell, label: "Price alerts & notifications" },
      ]} />

      <Group title="PRIVACY & LEGAL" rows={[
        { to: "/legal/privacy", Icon: Lock, label: "Privacy Policy" },
        { to: "/legal/terms", Icon: FileText, label: "Terms of Service" },
        { to: "/legal/risk-disclosure", Icon: AlertTriangle, label: "Risk Disclosure" },
      ]} />

      {isAdmin && <Group title="ADMINISTRATION" rows={[{ to: "/admin", Icon: Shield, label: "Admin Panel" }]} />}

      <button
        onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
        className="glass rounded-2xl flex items-center justify-center gap-2 border-none cursor-pointer"
        style={{ padding: 15, color: "var(--gc-danger)", fontFamily: "var(--font-display)", fontSize: 12, letterSpacing: "0.08em" }}
      >
        <LogOut size={16} /> SIGN OUT
      </button>
    </div>
  );
}
