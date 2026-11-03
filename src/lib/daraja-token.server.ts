import { getMpesaUrls } from "@/lib/mpesa-config.server";

// Daraja access tokens last about an hour. Cache one per process and refresh a minute early, so
// polling and payouts do not hit the OAuth endpoint on every call (review decision R10).
let cached: { token: string; expiresAt: number; url: string } | null = null;

export async function getDarajaToken(
  consumerKey: string,
  consumerSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = getMpesaUrls().oauth;
  const now = Date.now();
  if (cached && cached.url === url && cached.expiresAt > now) return cached.token;

  const res = await fetchImpl(url, {
    headers: { Authorization: "Basic " + btoa(`${consumerKey}:${consumerSecret}`) },
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: string | number };
  if (!data.access_token) throw new Error("oauth: no access_token");
  const ttlMs = Math.max(30, Number(data.expires_in ?? 3599) - 60) * 1000;
  cached = { token: data.access_token, expiresAt: now + ttlMs, url };
  return data.access_token;
}

/** Test helper. */
export function resetDarajaTokenCache() {
  cached = null;
}
