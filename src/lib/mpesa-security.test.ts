import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  isSandboxPaymentsEnabled,
  mayStartMpesaPayment,
  verifySafaricomOrigin,
  withCallbackSecret,
} from "./mpesa-security.server";

const SECRET = "x".repeat(32);
const req = (qs = "") =>
  new Request(`https://app.example.com/api/mpesa-callback${qs}`, { method: "POST" });

describe("constantTimeEqual", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("verifySafaricomOrigin (fail closed)", () => {
  it("rejects when no secret is configured and MPESA_ENV is unset (treated as production)", () => {
    expect(verifySafaricomOrigin(req(), {})).toBe(false);
  });

  it("rejects when MPESA_ENV is production and no secret is configured", () => {
    expect(verifySafaricomOrigin(req(), { MPESA_ENV: "production" })).toBe(false);
  });

  it("allows an unauthenticated callback only in explicit sandbox with no secret", () => {
    expect(verifySafaricomOrigin(req(), { MPESA_ENV: "sandbox" })).toBe(true);
  });

  it("ignores spoofable forwarding headers", () => {
    const r = new Request("https://app.example.com/api/mpesa-callback", {
      method: "POST",
      headers: { "x-forwarded-for": "196.201.214.200", "x-real-ip": "196.201.214.200" },
    });
    expect(verifySafaricomOrigin(r, { MPESA_ENV: "production" })).toBe(false);
  });

  it("requires the right secret when one is configured, even in sandbox", () => {
    const env = { MPESA_ENV: "sandbox", MPESA_CALLBACK_SECRET: SECRET };
    expect(verifySafaricomOrigin(req(), env)).toBe(false);
    expect(verifySafaricomOrigin(req("?s=wrong"), env)).toBe(false);
    expect(verifySafaricomOrigin(req(`?s=${SECRET}`), env)).toBe(true);
  });

  it("rejects a secret that is too short (misconfiguration), even in sandbox", () => {
    expect(
      verifySafaricomOrigin(req("?s=short"), {
        MPESA_ENV: "sandbox",
        MPESA_CALLBACK_SECRET: "short",
      }),
    ).toBe(false);
  });
});

describe("withCallbackSecret", () => {
  it("appends the secret to the registered URL", () => {
    const out = withCallbackSecret("https://app.example.com/api/mpesa-callback", {
      MPESA_CALLBACK_SECRET: SECRET,
    });
    expect(new URL(out).searchParams.get("s")).toBe(SECRET);
  });

  it("leaves the URL alone without a usable secret", () => {
    expect(withCallbackSecret("https://app.example.com/x", {})).toBe("https://app.example.com/x");
  });
});

describe("sandbox payment gate", () => {
  const sandbox = { MPESA_ENV: "sandbox", MPESA_SANDBOX_ENABLED: "true" };

  it("allows sandbox payments only when explicitly enabled", () => {
    expect(isSandboxPaymentsEnabled(sandbox)).toBe(true);
    expect(isSandboxPaymentsEnabled({ MPESA_ENV: "sandbox" })).toBe(false);
    expect(isSandboxPaymentsEnabled({ MPESA_SANDBOX_ENABLED: "true" })).toBe(false); // env unset = production
    expect(isSandboxPaymentsEnabled({ ...sandbox, MPESA_SANDBOX_ENABLED: "yes" })).toBe(false);
  });

  it("never allows fake sandbox money on Vercel production", () => {
    expect(isSandboxPaymentsEnabled({ ...sandbox, VERCEL_ENV: "production" })).toBe(false);
    expect(isSandboxPaymentsEnabled({ ...sandbox, VERCEL_ENV: "preview" })).toBe(true);
  });

  it("ignores the live flag when pointed at the sandbox", () => {
    // A mistaken mpesa_live=true must not let sandbox money credit real wallets.
    expect(mayStartMpesaPayment(true, { MPESA_ENV: "sandbox" })).toBe(false);
    expect(mayStartMpesaPayment(false, sandbox)).toBe(true);
  });

  it("requires the compliance flag against the real Daraja API", () => {
    expect(mayStartMpesaPayment(false, { MPESA_ENV: "production" })).toBe(false);
    expect(mayStartMpesaPayment(true, { MPESA_ENV: "production" })).toBe(true);
    expect(mayStartMpesaPayment(false, {})).toBe(false); // unset env is production
  });
});
