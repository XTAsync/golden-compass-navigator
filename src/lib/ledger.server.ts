// Thin, typed wrappers around the atomic money functions in Postgres
// (supabase/migrations/20261025120000_atomic_money_flows.sql).
//
// All balance and status changes for deposits and withdrawals go through these functions.
// Each one runs as a single database transaction with row locks, so a retry, a double click or
// two parallel requests can never credit, pay or refund twice. Never update wallet_balance,
// user_investments or transaction status directly from route code.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LedgerResult = { result: string } & Record<string, unknown>;

async function rpc(fn: string, args: Record<string, unknown>): Promise<LedgerResult> {
  // The generated Supabase types don't include these functions yet (same cast the repo already uses
  // for credit_wallet); the result shape is documented in the migration and checked by the callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin.rpc as any)(fn, args);
  if (error) throw new Error(`ledger.${fn} failed: ${error.message}`);
  return data as LedgerResult;
}

export function confirmDeposit(args: {
  checkoutId: string;
  resultCode: number | null;
  receipt: string | null;
  paidAmount: number | null;
}) {
  return rpc("confirm_deposit", {
    p_checkout_id: args.checkoutId,
    p_result_code: args.resultCode,
    p_receipt: args.receipt,
    p_paid_amount: args.paidAmount,
  });
}

/**
 * Park (or settle) a callback whose transaction has no checkout id yet. See
 * supabase/migrations/20261027120000_mpesa_callback_inbox.sql.
 */
export function queueUnmatchedCallback(args: {
  checkoutId: string;
  resultCode: number | null;
  receipt: string | null;
  paidAmount: number | null;
}) {
  return rpc("queue_unmatched_callback", {
    p_checkout_id: args.checkoutId,
    p_result_code: args.resultCode,
    p_receipt: args.receipt,
    p_paid_amount: args.paidAmount,
  });
}

/** Save the checkout id on a pending deposit and settle any callback that arrived first. */
export function attachCheckoutId(txId: string, checkoutId: string) {
  return rpc("attach_checkout_id", { p_tx_id: txId, p_checkout_id: checkoutId });
}

export function requestWithdrawal(args: {
  userId: string;
  poolId: string;
  amount: number;
  phone: string;
  requestId?: string | null;
  expectedNet?: number | null;
}) {
  return rpc("request_withdrawal", {
    p_user_id: args.userId,
    p_pool_id: args.poolId,
    p_amount: args.amount,
    p_phone: args.phone,
    p_request_id: args.requestId ?? null,
    p_expected_net: args.expectedNet ?? null,
  });
}

/** Wallet-balance withdrawal (PR2 migration, T9): debits the wallet and queues the payout. */
export function requestWalletWithdrawal(args: {
  userId: string;
  amount: number;
  phone: string;
  requestId?: string | null;
  expectedNet?: number | null;
}) {
  return rpc("request_wallet_withdrawal", {
    p_user_id: args.userId,
    p_amount: args.amount,
    p_phone: args.phone,
    p_request_id: args.requestId ?? null,
    p_expected_net: args.expectedNet ?? null,
  });
}

/** Wallet -> pool in one transaction (PR2 migration, T8). */
export function investInPool(args: {
  userId: string;
  poolId: string;
  amount: number;
  requestId?: string | null;
}) {
  return rpc("invest_in_pool", {
    p_user_id: args.userId,
    p_pool_id: args.poolId,
    p_amount: args.amount,
    p_request_id: args.requestId ?? null,
  });
}

/** Quote, pause/cap status and pending amounts in one read (PR2 migration, T13). */
export function moneyConfig(args: {
  userId: string;
  source?: "wallet" | "pool" | null;
  poolId?: string | null;
  amount?: number | null;
}) {
  return rpc("money_config", {
    p_user_id: args.userId,
    p_source: args.source ?? null,
    p_pool_id: args.poolId ?? null,
    p_amount: args.amount ?? null,
  });
}

export function approveWithdrawalStart(txId: string, adminId: string) {
  return rpc("approve_withdrawal_start", { p_tx_id: txId, p_admin_id: adminId });
}

/** Fail a withdrawal and refund the reserved units, once. `allowedFrom` limits which states may fail. */
export function failWithdrawal(txId: string, reason: string, allowedFrom: string[]) {
  return rpc("fail_withdrawal", { p_tx_id: txId, p_reason: reason, p_allowed_from: allowedFrom });
}

export function completeWithdrawal(txId: string, receipt: string | null) {
  return rpc("complete_withdrawal", { p_tx_id: txId, p_receipt: receipt });
}

/** Mark a still-pending deposit failed or cancelled, once (PR1 migration, T1). */
export function failDeposit(txId: string, reason: string, cancelled = false) {
  return rpc("fail_deposit", { p_tx_id: txId, p_reason: reason, p_cancelled: cancelled });
}

/** Record a B2C queue-timeout notice. Never refunds or fails the withdrawal (T4). */
export function recordB2cTimeout(txId: string, detail: string) {
  return rpc("record_b2c_timeout", { p_tx_id: txId, p_detail: detail });
}

export type StuckDeposit = { id: string; mpesa_checkout_id: string; amount: number; user_id: string };

/** Claim up to `limit` (max 20) stuck pending deposits for reconcile; overlapping runs never share rows (T5). */
export async function claimStuckDeposits(limit = 20): Promise<StuckDeposit[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin.rpc as any)("claim_stuck_deposits", { p_limit: limit });
  if (error) throw new Error(`ledger.claim_stuck_deposits failed: ${error.message}`);
  return (data ?? []) as StuckDeposit[];
}

/** Move old unmatched callbacks to the archive table; returns how many moved (T5). */
export async function archiveOldUnmatchedCallbacks(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin.rpc as any)("archive_old_unmatched_callbacks", {});
  if (error) throw new Error(`ledger.archive_old_unmatched_callbacks failed: ${error.message}`);
  return Number(data ?? 0);
}

/** An admin resolves a held (paid, no receipt) deposit with the receipt from the M-Pesa statement (D10). */
export function resolveHeldDeposit(txId: string, receipt: string, adminId: string) {
  return rpc("resolve_held_deposit", { p_tx_id: txId, p_receipt: receipt, p_admin_id: adminId });
}

export type LedgerCheck = { chain: { ok: boolean; [k: string]: unknown }; balances: { ok: boolean; [k: string]: unknown } };

/** Audit-trail integrity (E5): recent hash chain plus wallet balances against the last audited value. */
export async function verifyLedger(lastRows = 2000): Promise<LedgerCheck> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rp = supabaseAdmin.rpc as any;
  const [c, b] = await Promise.all([rp("verify_ledger_chain", { p_last: lastRows }), rp("verify_wallet_balances", {})]);
  if (c.error) throw new Error(`ledger.verify_ledger_chain failed: ${c.error.message}`);
  if (b.error) throw new Error(`ledger.verify_wallet_balances failed: ${b.error.message}`);
  return { chain: c.data, balances: b.data };
}
