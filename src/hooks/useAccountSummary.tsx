import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface PoolHolding {
  id: string;
  pool_id: string;
  name: string;
  pool_type: string | null;
  units: number;
  invested: number;
  value: number;
  exit_fee_percent: number;
  holding_period_days: number;
  /** ISO time the holding unlocks (first investment + holding period), or null when never locked. */
  unlocks_at: string | null;
}

export interface AccountSummary {
  loading: boolean;
  fullName: string;
  firstName: string;
  kycStatus: string;
  phone: string;
  wallet: number;
  invested: number;
  poolsValue: number;
  stocksInvested: number;
  positionsCount: number;
  totalValue: number;
  gain: number;
  gainPct: number;
  poolHoldings: PoolHolding[];
  refresh: () => void;
}

/** First investment + holding period. A top-up never moves it (DR2). */
export function unlockAt(createdAt: string | null | undefined, days: number): string | null {
  if (!createdAt || !(days > 0)) return null;
  return new Date(new Date(createdAt).getTime() + days * 86_400_000).toISOString();
}

export const KES = (n: number) =>
  "KES " + Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function useAccountSummary(): AccountSummary {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("Investor");
  const [kycStatus, setKycStatus] = useState("not_started");
  const [phone, setPhone] = useState("");
  const [wallet, setWallet] = useState(0);
  const [poolHoldings, setPoolHoldings] = useState<PoolHolding[]>([]);
  const [stocksInvested, setStocksInvested] = useState(0);
  const [positionsCount, setPositionsCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: profile }, { data: pools }, { data: stocks }] = await Promise.all([
        supabase.from("profiles").select("full_name, kyc_status, wallet_balance, phone").eq("id", user.id).maybeSingle(),
        supabase
          .from("user_investments")
          .select(
            "id, pool_id, invested_amount, current_value, units_owned, created_at, investment_pools(name, pool_type, exit_fee_percent, holding_period_days)",
          )
          .eq("user_id", user.id),
        supabase.from("stock_holdings").select("id, invested_amount, quantity").eq("user_id", user.id),
      ]);
      if (cancelled) return;

      if (profile?.full_name) setFullName(profile.full_name);
      setKycStatus(profile?.kyc_status ?? "not_started");
      setWallet(Number(profile?.wallet_balance ?? 0));
      setPhone(String((profile as { phone?: string | null } | null)?.phone ?? ""));

      setPoolHoldings(
        ((pools ?? []) as unknown as Array<Record<string, any>>).map((p) => ({
          id: String(p.id),
          pool_id: String(p.pool_id),
          name: p.investment_pools?.name ?? "Pool",
          pool_type: p.investment_pools?.pool_type ?? null,
          units: Number(p.units_owned ?? 0),
          invested: Number(p.invested_amount ?? 0),
          value: Number(p.current_value ?? 0),
          exit_fee_percent: Number(p.investment_pools?.exit_fee_percent ?? 0),
          holding_period_days: Number(p.investment_pools?.holding_period_days ?? 0),
          unlocks_at: unlockAt(p.created_at, Number(p.investment_pools?.holding_period_days ?? 0)),
        })),
      );

      const rows = stocks ?? [];
      setStocksInvested(rows.reduce((s, r) => s + Number(r.invested_amount ?? 0), 0));
      setPositionsCount(rows.length);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tick]);

  const poolsValue = poolHoldings.reduce((s, p) => s + p.value, 0);
  const poolsInvested = poolHoldings.reduce((s, p) => s + p.invested, 0);
  const invested = poolsInvested + stocksInvested;
  const totalValue = poolsValue + stocksInvested + wallet;
  const gain = poolsValue - poolsInvested;
  const gainPct = poolsInvested > 0 ? (gain / poolsInvested) * 100 : 0;

  return {
    loading,
    fullName,
    firstName: fullName.split(" ")[0] || "Investor",
    kycStatus,
    phone,
    wallet,
    invested,
    poolsValue,
    stocksInvested,
    positionsCount,
    totalValue,
    gain,
    gainPct,
    poolHoldings,
    refresh: () => setTick((t) => t + 1),
  };
}
