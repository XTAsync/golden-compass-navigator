import { useEffect, useRef, useState } from "react";
import { fetchMoneyConfig, type MoneyConfig } from "@/lib/money-client";

/**
 * Reads /api/money-config. While the user types, the request is debounced (300 ms) and `stale` is
 * true until the answer matches the amount shown (design DR6), so the sheet never lets a stale quote
 * be submitted. A failed read sets `error` (DR7): the sheet disables its button.
 */
export function useMoneyConfig(params: { source?: "wallet" | "pool"; poolId?: string; amount?: number }, enabled = true) {
  const [data, setData] = useState<MoneyConfig | null>(null);
  const [error, setError] = useState(false);
  const [answeredKey, setAnsweredKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${params.source ?? ""}|${params.poolId ?? ""}|${params.amount ?? ""}`;
  const latest = useRef(key);
  latest.current = key;

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const cfg = await fetchMoneyConfig(params, ctrl.signal);
        if (latest.current !== key) return;
        setData(cfg);
        setError(false);
        setAnsweredKey(key);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(true);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, retry]);

  return { data, error, stale: answeredKey !== key, retry: () => { setError(false); setRetry((n) => n + 1); } };
}
