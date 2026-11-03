import { describe, expect, it } from "vitest";
import { moneyErrorResponse } from "./money-errors";

describe("moneyErrorResponse", () => {
  it("returns null for success and replays", () => {
    expect(moneyErrorResponse({ result: "ok" })).toBeNull();
    expect(moneyErrorResponse({ result: "replayed" })).toBeNull();
  });
  it("gives the new numbers on a changed quote, with status 409", () => {
    const r = moneyErrorResponse({ result: "quote_changed", gross: 1000, fee: 15, net: 985 })!;
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "quote_changed", net: 985, fee: 15 });
    expect(String(r.body.error)).toContain("985");
  });
  it("tells the user what is left under a cap", () => {
    const r = moneyErrorResponse({ result: "over_user_cap", left: 2500 })!;
    expect(String(r.body.error)).toContain("2,500");
  });
  it("uses 503 for pause and global cap, 400 for user mistakes", () => {
    expect(moneyErrorResponse({ result: "paused" })!.status).toBe(503);
    expect(moneyErrorResponse({ result: "over_global_cap" })!.status).toBe(503);
    expect(moneyErrorResponse({ result: "below_min", min: 100 })!.status).toBe(400);
    expect(moneyErrorResponse({ result: "something_new" })!.status).toBe(400);
  });
  it("pluralises the lock days", () => {
    expect(String(moneyErrorResponse({ result: "locked", days_remaining: 1 })!.body.error)).toContain("1 more day.");
    expect(String(moneyErrorResponse({ result: "locked", days_remaining: 5 })!.body.error)).toContain("5 more days.");
  });
});
