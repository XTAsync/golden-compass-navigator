// Ops alerts (review decision E2). Events are written to ops_outbox by the database (pause flag
// flips, deposits held for review, stuck withdrawals) or by enqueueOpsEvent; drainOpsOutbox posts
// them to OPS_WEBHOOK_URL (a Slack or Discord style webhook). Delivery failures never break a
// money request: the event stays in the outbox and is retried (max 5 attempts).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type OpsEventRow = { id: number; event: string; payload: Record<string, unknown>; created_at: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcAny = (fn: string, args: Record<string, unknown>) => (supabaseAdmin.rpc as any)(fn, args);

export async function enqueueOpsEvent(event: string, payload: Record<string, unknown>, dedupeKey?: string) {
  try {
    await rpcAny("enqueue_ops_event", { p_event: event, p_payload: payload, p_dedupe_key: dedupeKey ?? null });
  } catch (e) {
    console.error("[ops-alerts] could not enqueue", event, e);
  }
}

/** One alert per hour at most, however many rejected callbacks arrive. */
export function rejectedCallbackKey(now = new Date()) {
  return `cb_rejected:${now.toISOString().slice(0, 13)}`;
}

export function formatOpsEvent(e: Pick<OpsEventRow, "event" | "payload" | "created_at">): string {
  const p = e.payload ?? {};
  switch (e.event) {
    case "pause_flag_changed":
      return `Pause flag ${String(p.flag)} changed: ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}`;
    case "held_for_review":
      return `Deposit held for review (${String(p.reason)}), KES ${String(p.amount)}, transaction ${String(p.transaction_id)}`;
    case "withdrawal_stuck":
      return `Withdrawal ${String(p.transaction_id)} (KES ${String(p.amount)}) has been processing for over ${String(p.minutes)} minutes. Check the M-Pesa statement before refunding.`;
    case "callback_rejected":
      return "A callback to the M-Pesa endpoint was rejected (bad or missing secret).";
    case "ledger_integrity_failed":
      return `LEDGER INTEGRITY CHECK FAILED. Pause withdrawals and investigate: ${JSON.stringify(p)}`;
    case "reconcile_attention":
      return `Reconcile run needs attention: ${JSON.stringify(p)}`;
    default:
      return `${e.event}: ${JSON.stringify(p)}`;
  }
}

export type DrainDeps = {
  claim: (limit: number) => Promise<OpsEventRow[]>;
  markSent: (ids: number[]) => Promise<void>;
  fetchImpl: typeof fetch;
  webhookUrl: string;
};

export function defaultDrainDeps(env: Record<string, string | undefined> = process.env): DrainDeps {
  return {
    claim: async (limit) => {
      const { data, error } = await rpcAny("claim_ops_events", { p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as OpsEventRow[];
    },
    markSent: async (ids) => {
      const { error } = await rpcAny("mark_ops_events_sent", { p_ids: ids });
      if (error) throw new Error(error.message);
    },
    fetchImpl: fetch,
    webhookUrl: env.OPS_WEBHOOK_URL ?? "",
  };
}

/** Posts up to 20 events. Returns how many were delivered. Never throws. */
export async function drainOpsOutbox(deps: DrainDeps = defaultDrainDeps()): Promise<{ sent: number; failed: number }> {
  if (!deps.webhookUrl) return { sent: 0, failed: 0 };
  let rows: OpsEventRow[] = [];
  try {
    rows = await deps.claim(20);
  } catch (e) {
    console.error("[ops-alerts] claim failed", e);
    return { sent: 0, failed: 0 };
  }
  const delivered: number[] = [];
  let failed = 0;
  for (const row of rows) {
    const text = `[Golden Compass] ${formatOpsEvent(row)}`;
    try {
      const res = await deps.fetchImpl(deps.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) delivered.push(row.id);
      else failed++;
    } catch {
      failed++;
    }
  }
  if (delivered.length) {
    try {
      await deps.markSent(delivered);
    } catch (e) {
      console.error("[ops-alerts] markSent failed", e);
    }
  }
  return { sent: delivered.length, failed };
}
