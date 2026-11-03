import { describe, expect, it, vi } from "vitest";
import { fakeDaraja } from "@/test/fake-daraja";
import { reconcileStuckDeposits, type ReconcileDeps } from "./reconcile.server";

function deps(rows: Array<{ id: string; mpesa_checkout_id: string; amount: number; user_id: string }>, replies: Parameters<typeof fakeDaraja>[0]) {
  const d = fakeDaraja(replies);
  const confirm = vi.fn(async () => ({ result: "missing_receipt" }));
  const fail = vi.fn(async () => ({ result: "failed" }));
  const dep: ReconcileDeps = {
    claim: vi.fn(async () => rows),
    archive: vi.fn(async () => 2),
    confirm, fail,
    token: async () => "tok",
    fetchImpl: d.fetchImpl,
    stkQueryUrl: "https://fake/stkpushquery",
    shortcode: "174379", passkey: "pk",
    now: () => new Date("2026-11-01T10:00:00Z"),
  };
  return { dep, confirm, fail, calls: d.calls };
}
const row = (n: number) => ({ id: `tx${n}`, mpesa_checkout_id: `co${n}`, amount: 100, user_id: "u" });

describe("reconcileStuckDeposits", () => {
  it("does nothing when there is nothing stuck", async () => {
    const { dep, calls } = deps([], {});
    const s = await reconcileStuckDeposits(dep);
    expect(s.claimed).toBe(0);
    expect(s.archived_callbacks).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it("paid (code 0) goes to review without a receipt and never credits directly", async () => {
    const { dep, confirm, fail } = deps([row(1)], { co1: { ResultCode: "0" } });
    const s = await reconcileStuckDeposits(dep);
    expect(s.held_for_review).toBe(1);
    expect(confirm).toHaveBeenCalledWith({ checkoutId: "co1", resultCode: 0, receipt: null, paidAmount: 100 });
    expect(fail).not.toHaveBeenCalled();
  });

  it("marks only explicit terminal codes as failed or cancelled", async () => {
    const { dep, fail } = deps([row(1), row(2), row(3), row(4)], {
      co1: { ResultCode: "1032" }, co2: { ResultCode: 2001 }, co3: { ResultCode: "1037" }, co4: { ResultCode: "9999" },
    });
    const s = await reconcileStuckDeposits(dep);
    expect(s).toMatchObject({ cancelled: 1, failed: 2, still_pending: 1 });
    expect(fail).toHaveBeenCalledWith("tx1", "reconcile: result_code_1032", true);
    expect(fail).toHaveBeenCalledWith("tx2", "reconcile: result_code_2001", false);
    expect(fail).not.toHaveBeenCalledWith("tx4", expect.anything(), expect.anything());
  });

  it("leaves a still-processing row alone", async () => {
    const { dep, confirm, fail } = deps([row(1)], { co1: { errorCode: "500.001.1001" } });
    const s = await reconcileStuckDeposits(dep);
    expect(s.still_pending).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("one network failure does not stop the other rows", async () => {
    const { dep, fail } = deps([row(1), row(2)], { co1: "throw", co2: { ResultCode: "1032" } });
    const s = await reconcileStuckDeposits(dep);
    expect(s.errors).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
