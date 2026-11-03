import { supabase } from "@/integrations/supabase/client";

export type MoneyConfig = {
  quote: null | { result: string; gross?: number; fee?: number; net?: number; min?: number };
  paused: { withdrawals: boolean; investing: boolean };
  caps: { user_used: number; user_cap: number; user_left: number; global_used: number; global_cap: number; global_left: number };
  pending: { withdrawals_pending: number; withdrawals_pending_count: number; deposits_pending: number; deposits_pending_count: number };
  wallet_balance: number;
};

/** One id per sheet open: a repeat tap returns the first result instead of a second request (D9, D19). */
export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function fetchMoneyConfig(
  params: { source?: "wallet" | "pool"; poolId?: string; amount?: number },
  signal?: AbortSignal,
): Promise<MoneyConfig> {
  const t = await token();
  if (!t) throw new Error("not_signed_in");
  const q = new URLSearchParams();
  if (params.source) q.set("source", params.source);
  if (params.poolId) q.set("pool_id", params.poolId);
  if (params.amount != null) q.set("amount", String(params.amount));
  const res = await fetch(`/api/money-config?${q}`, { headers: { Authorization: `Bearer ${t}` }, signal });
  if (!res.ok) throw new Error(`money-config ${res.status}`);
  return (await res.json()) as MoneyConfig;
}

export type PostResult = { ok: boolean; status: number; data: Record<string, any> };

export async function postMoney(path: string, body: Record<string, unknown>): Promise<PostResult> {
  const t = await token();
  if (!t) return { ok: false, status: 401, data: { error: "Please log in again" } };
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !data.error, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "No connection. Check your network and try again." } };
  }
}
