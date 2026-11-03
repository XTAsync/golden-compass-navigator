// Fake Daraja for tests (review decision E4). A drop-in `fetch` that answers STK Query / OAuth
// from a script, so reconcile and route logic can be exercised without the network.
export type FakeStkReply =
  | { ResultCode: string | number }
  | { errorCode: string }
  | "throw";

export function fakeDaraja(replies: Record<string, FakeStkReply>) {
  const calls: Array<{ url: string; checkoutId?: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/oauth/")) {
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: "3599" }));
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const id = body.CheckoutRequestID as string | undefined;
    calls.push({ url, checkoutId: id });
    const reply = id ? replies[id] : undefined;
    if (reply === "throw") throw new Error("network down");
    if (!reply) return new Response(JSON.stringify({ errorCode: "404.001.03" }), { status: 404 });
    return new Response(JSON.stringify(reply));
  }) as typeof fetch;
  return { fetchImpl, calls };
}
