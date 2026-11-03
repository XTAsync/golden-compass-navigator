import { afterEach, describe, expect, it, vi } from "vitest";

// The cron routes must fail closed (503 without a long secret), reject a wrong secret (401), and
// must NOT accept the public Supabase key any more (review decision D8).
vi.mock("@/lib/alerts.server", () => ({ runPriceAlertScan: vi.fn(async () => ({ scanned: 0 })) }));
vi.mock("@/lib/reconcile.server", () => ({
  defaultDeps: () => ({}),
  reconcileStuckDeposits: vi.fn(async () => ({ claimed: 0 })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: vi.fn(async () => ({ data: 0, error: null })) },
}));
vi.mock("@/lib/ledger.server", () => ({
  verifyLedger: vi.fn(async () => ({ chain: { ok: true }, balances: { ok: true } })),
}));
vi.mock("@/lib/ops-alerts.server", () => ({
  enqueueOpsEvent: vi.fn(async () => {}),
  drainOpsOutbox: vi.fn(async () => ({ sent: 0, failed: 0 })),
}));

const SECRET = "s".repeat(32);

async function call(path: "check-price-alerts" | "reconcile-deposits", headers: Record<string, string>) {
  const mod = await import(`./${path}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (mod.Route as any).options.server.handlers.POST;
  return handler({ request: new Request("http://x/api", { method: "POST", headers }) }) as Promise<Response>;
}

afterEach(() => {
  delete process.env.ALERTS_CRON_SECRET;
  delete process.env.RECONCILE_CRON_SECRET;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
});

describe.each([
  ["check-price-alerts", "ALERTS_CRON_SECRET"],
  ["reconcile-deposits", "RECONCILE_CRON_SECRET"],
] as const)("%s", (path, envName) => {
  it("is closed when the secret is not set", async () => {
    expect((await call(path, { "x-cron-secret": SECRET })).status).toBe(503);
  });
  it("is closed when the secret is too short", async () => {
    process.env[envName] = "short";
    expect((await call(path, { "x-cron-secret": "short" })).status).toBe(503);
  });
  it("rejects a wrong secret and the publishable key", async () => {
    process.env[envName] = SECRET;
    process.env.SUPABASE_PUBLISHABLE_KEY = "p".repeat(40);
    expect((await call(path, { "x-cron-secret": "w".repeat(32) })).status).toBe(401);
    expect((await call(path, { apikey: "p".repeat(40) })).status).toBe(401);
  });
  it("runs with the right secret", async () => {
    process.env[envName] = SECRET;
    expect((await call(path, { "x-cron-secret": SECRET })).status).toBe(200);
  });
});
