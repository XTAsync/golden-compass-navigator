// Reconcile stuck pending deposits (review decision D7 / T5).
//
// A deposit can stay pending if Safaricom's callback never arrives. This asks Daraja (STK Query)
// about at most 20 stuck rows per run and settles them through the same atomic functions the
// callback uses. Rules:
//   - ResultCode 0: the customer paid, but STK Query carries no receipt, so confirm_deposit is
//     called without one. It keeps the deposit pending, raises a high-severity flag and a human
//     resolves it with the M-Pesa receipt. Reconcile never credits a wallet by itself.
//   - Explicit terminal codes (1032 cancelled, 1037 timeout, 2001 wrong PIN, 1 insufficient
//     funds) mark the deposit cancelled/failed through fail_deposit.
//   - "Still processing" or anything unrecognised leaves the row alone (retried later).
import { getDarajaToken } from "@/lib/daraja-token.server";
import { getMpesaUrls } from "@/lib/mpesa-config.server";
import {
  archiveOldUnmatchedCallbacks,
  claimStuckDeposits,
  confirmDeposit,
  failDeposit,
  type LedgerResult,
  type StuckDeposit,
} from "@/lib/ledger.server";

export const TERMINAL_FAILURE_CODES = new Set(["1032", "1037", "2001", "1"]);

export type ReconcileSummary = {
  claimed: number;
  held_for_review: number;
  cancelled: number;
  failed: number;
  still_pending: number;
  errors: number;
  archived_callbacks: number;
};

export type ReconcileDeps = {
  claim: (limit: number) => Promise<StuckDeposit[]>;
  archive: () => Promise<number>;
  confirm: (a: { checkoutId: string; resultCode: number | null; receipt: string | null; paidAmount: number | null }) => Promise<LedgerResult>;
  fail: (txId: string, reason: string, cancelled: boolean) => Promise<LedgerResult>;
  token: () => Promise<string>;
  fetchImpl: typeof fetch;
  stkQueryUrl: string;
  shortcode: string;
  passkey: string;
  now: () => Date;
};

export function defaultDeps(env: Record<string, string | undefined> = process.env): ReconcileDeps {
  return {
    claim: claimStuckDeposits,
    archive: archiveOldUnmatchedCallbacks,
    confirm: confirmDeposit,
    fail: failDeposit,
    token: () => getDarajaToken(env.MPESA_CONSUMER_KEY ?? "", env.MPESA_CONSUMER_SECRET ?? ""),
    fetchImpl: fetch,
    stkQueryUrl: getMpesaUrls().stkQuery,
    shortcode: env.MPESA_SHORTCODE ?? "",
    passkey: env.MPESA_PASSKEY ?? "",
    now: () => new Date(),
  };
}

export async function reconcileStuckDeposits(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    claimed: 0, held_for_review: 0, cancelled: 0, failed: 0, still_pending: 0, errors: 0, archived_callbacks: 0,
  };
  summary.archived_callbacks = await deps.archive();

  const rows = await deps.claim(20);
  summary.claimed = rows.length;
  if (rows.length === 0) return summary;

  const token = await deps.token();
  for (const row of rows) {
    try {
      const ts = deps.now().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
      const res = await deps.fetchImpl(deps.stkQueryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          BusinessShortCode: deps.shortcode,
          Password: btoa(`${deps.shortcode}${deps.passkey}${ts}`),
          Timestamp: ts,
          CheckoutRequestID: row.mpesa_checkout_id,
        }),
      });
      const data = (await res.json()) as { ResultCode?: string | number; errorCode?: string };
      if (data.errorCode === "500.001.1001") { summary.still_pending++; continue; }

      const code = data.ResultCode == null ? null : String(data.ResultCode);
      if (code === "0") {
        await deps.confirm({ checkoutId: row.mpesa_checkout_id, resultCode: 0, receipt: null, paidAmount: Number(row.amount) });
        summary.held_for_review++;
      } else if (code !== null && TERMINAL_FAILURE_CODES.has(code)) {
        const cancelled = code === "1032";
        await deps.fail(row.id, `reconcile: result_code_${code}`, cancelled);
        if (cancelled) summary.cancelled++; else summary.failed++;
      } else {
        summary.still_pending++;
      }
    } catch (e) {
      console.error("[reconcile] row failed", { id: row.id, error: e instanceof Error ? e.message : e });
      summary.errors++;
    }
  }
  return summary;
}
