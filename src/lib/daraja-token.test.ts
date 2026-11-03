import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDarajaToken, resetDarajaTokenCache } from "./daraja-token.server";

const ok = (token: string) =>
  vi.fn(async () => new Response(JSON.stringify({ access_token: token, expires_in: "3599" })));

describe("getDarajaToken", () => {
  beforeEach(() => resetDarajaTokenCache());

  it("fetches once and reuses the cached token", async () => {
    const f = ok("tok1");
    expect(await getDarajaToken("k", "s", f as unknown as typeof fetch)).toBe("tok1");
    expect(await getDarajaToken("k", "s", f as unknown as typeof fetch)).toBe("tok1");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("throws on an auth failure and does not cache it", async () => {
    const bad = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(getDarajaToken("k", "s", bad as unknown as typeof fetch)).rejects.toThrow("oauth 401");
    const f = ok("tok2");
    expect(await getDarajaToken("k", "s", f as unknown as typeof fetch)).toBe("tok2");
  });
});
