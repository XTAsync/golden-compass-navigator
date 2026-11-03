import { describe, expect, it, vi } from "vitest";
import { drainOpsOutbox, formatOpsEvent, rejectedCallbackKey, type OpsEventRow } from "./ops-alerts.server";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: vi.fn() } }));

const ev = (id: number): OpsEventRow => ({ id, event: "pause_flag_changed", payload: { flag: "withdrawals_paused", from: false, to: true }, created_at: "" });

describe("drainOpsOutbox", () => {
  it("does nothing without a webhook", async () => {
    const claim = vi.fn();
    expect(await drainOpsOutbox({ claim, markSent: vi.fn(), fetchImpl: vi.fn() as never, webhookUrl: "" })).toEqual({ sent: 0, failed: 0 });
    expect(claim).not.toHaveBeenCalled();
  });
  it("marks only delivered events as sent", async () => {
    const markSent = vi.fn(async () => {});
    const fetchImpl = vi.fn(async (_u: unknown, init: RequestInit) => {
      const n = JSON.parse(String(init.body)).text.length;
      return new Response("", { status: n > 0 && fetchImpl.mock.calls.length === 2 ? 500 : 200 });
    });
    const r = await drainOpsOutbox({ claim: async () => [ev(1), ev(2), ev(3)], markSent, fetchImpl: fetchImpl as never, webhookUrl: "https://hook" });
    expect(r).toEqual({ sent: 2, failed: 1 });
    expect(markSent).toHaveBeenCalledWith([1, 3]);
  });
  it("survives a network error and a claim error", async () => {
    const r = await drainOpsOutbox({ claim: async () => [ev(1)], markSent: vi.fn(), fetchImpl: (async () => { throw new Error("down"); }) as never, webhookUrl: "https://hook" });
    expect(r).toEqual({ sent: 0, failed: 1 });
    const r2 = await drainOpsOutbox({ claim: async () => { throw new Error("db"); }, markSent: vi.fn(), fetchImpl: vi.fn() as never, webhookUrl: "https://hook" });
    expect(r2).toEqual({ sent: 0, failed: 0 });
  });
});

describe("helpers", () => {
  it("rejected-callback key changes only hourly", () => {
    expect(rejectedCallbackKey(new Date("2026-11-01T10:05:00Z"))).toBe(rejectedCallbackKey(new Date("2026-11-01T10:59:00Z")));
    expect(rejectedCallbackKey(new Date("2026-11-01T10:05:00Z"))).not.toBe(rejectedCallbackKey(new Date("2026-11-01T11:00:00Z")));
  });
  it("describes known and unknown events", () => {
    expect(formatOpsEvent(ev(1))).toContain("withdrawals_paused");
    expect(formatOpsEvent({ event: "x", payload: { a: 1 }, created_at: "" })).toContain("x:");
  });
});
