import { describe, expect, it } from "vitest";
import { resolveLiveGates } from "./capabilities";

describe("owner's live service safeguards", () => {
  it("defaults real M-Pesa off", () => expect(resolveLiveGates({}).mpesaLive).toBe(false));
  it("defaults real investing off even when old broker config is live", () => {
    expect(resolveLiveGates({ broker_mode: "live" }).investLive).toBe(false);
  });
  it("requires explicit approval and live mode for real orders", () => {
    expect(resolveLiveGates({ broker_mode: "mock", invest_live: true }).investLive).toBe(false);
    expect(resolveLiveGates({ broker_mode: "live", invest_live: true }).investLive).toBe(true);
  });
  it("does not treat text true as M-Pesa approval", () => {
    expect(resolveLiveGates({ mpesa_live: "true" }).mpesaLive).toBe(false);
  });
  it("keeps CFDs disabled even if a row is enabled", () => {
    expect(resolveLiveGates({ cfd_enabled: true }).cfdEnabled).toBe(false);
  });
});