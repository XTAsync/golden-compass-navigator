import type { LedgerResult } from "@/lib/ledger.server";

const kes = (n: unknown) => `KES ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

/**
 * Turns a non-success result from the money functions into an HTTP status and a message the
 * sheets can show as-is (design decisions D8, D11). Returns null for "ok" and "replayed".
 */
export function moneyErrorResponse(res: LedgerResult): { status: number; body: Record<string, unknown> } | null {
  const r = res.result;
  if (r === "ok" || r === "replayed") return null;
  const e = (status: number, error: string, extra: Record<string, unknown> = {}) => ({
    status,
    body: { error, code: r, ...extra },
  });
  switch (r) {
    case "paused":
      return e(503, "This is paused for a moment. Your money is safe. Try again later.");
    case "invalid_amount":
      return e(400, "Enter a whole number of shillings.", { min: res.min });
    case "below_min":
      return e(400, `The minimum is ${kes(res.min)}.`, { min: res.min });
    case "invalid_source":
      return e(400, "Choose where to withdraw from.");
    case "pool_not_found":
    case "pool_not_available":
      return e(404, "That pool is not available.");
    case "no_holdings":
      return e(400, "You have no money in this pool.");
    case "insufficient_holdings":
      return e(400, `You can withdraw up to ${kes(res.max)} from this pool.`, { max: res.max });
    case "insufficient_wallet":
      return e(400, `Your wallet has ${kes(res.max)}.`, { max: res.max });
    case "locked": {
      const d = Number(res.days_remaining);
      return e(400, `This pool is locked for ${d} more day${d === 1 ? "" : "s"}.`, { days_remaining: d });
    }
    case "over_user_cap":
      return e(400, `You can withdraw ${kes(res.left)} more today.`, { left: res.left });
    case "over_global_cap":
      return e(503, "We have reached today's withdrawal limit. Try again tomorrow.");
    case "quote_changed":
      return e(409, `The fee changed. You now receive ${kes(res.net)}.`, { gross: res.gross, fee: res.fee, net: res.net });
    case "no_profile":
      return e(400, "Account not found.");
    default:
      return e(400, "Invalid input");
  }
}
