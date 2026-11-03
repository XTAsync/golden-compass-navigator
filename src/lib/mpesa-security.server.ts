// Callback authenticity for Safaricom (Daraja) webhooks.
//
// Safaricom does not sign callbacks and its source IPs are not a safe control (headers like
// x-forwarded-for are client-controlled and the published ranges change), so we authenticate
// callbacks with a long random secret that only Safaricom and we know: it is appended to the
// callback URLs we register (?s=<secret>) and compared in constant time.
//
// Fail closed: with no valid secret configured, callbacks are accepted ONLY when MPESA_ENV is
// explicitly "sandbox". An unset MPESA_ENV is treated as production.

export const MIN_SECRET_LENGTH = 24;

type Env = Record<string, string | undefined>;

/** Constant-time string comparison (no early exit on the first differing character). */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function isExplicitSandbox(env: Env = process.env): boolean {
  return (env.MPESA_ENV ?? "").trim().toLowerCase() === "sandbox";
}

/** True when a usable secret is configured. */
export function hasCallbackSecret(env: Env = process.env): boolean {
  return (env.MPESA_CALLBACK_SECRET ?? "").length >= MIN_SECRET_LENGTH;
}

/**
 * Returns true if this callback request is allowed to change money state.
 * Kept under the old name so existing imports keep working.
 */
export function verifySafaricomOrigin(request: Request, env: Env = process.env): boolean {
  const expected = env.MPESA_CALLBACK_SECRET ?? "";

  if (expected.length < MIN_SECRET_LENGTH) {
    // No (or too short) secret. Only an explicit sandbox may run without one.
    if (expected.length > 0) {
      console.error("[mpesa-security] MPESA_CALLBACK_SECRET is shorter than the minimum length");
    }
    return isExplicitSandbox(env) && expected.length === 0;
  }

  let provided = "";
  try {
    provided = new URL(request.url).searchParams.get("s") ?? "";
  } catch {
    return false;
  }
  return constantTimeEqual(provided, expected);
}

/** Append the callback secret to a URL we register with Safaricom (no-op without a secret). */
export function withCallbackSecret(url: string, env: Env = process.env): string {
  const secret = env.MPESA_CALLBACK_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return url;
  const u = new URL(url);
  u.searchParams.set("s", secret);
  return u.toString();
}

/**
 * Sandbox payments move FAKE money. They are allowed only when MPESA_SANDBOX_ENABLED=true is set
 * explicitly, MPESA_ENV is explicitly "sandbox", and the deployment is not Vercel production.
 * Set MPESA_SANDBOX_ENABLED only on the Preview/Development environments, never on Production.
 */
export function isSandboxPaymentsEnabled(env: Env = process.env): boolean {
  return (
    isExplicitSandbox(env) &&
    (env.MPESA_SANDBOX_ENABLED ?? "").trim().toLowerCase() === "true" &&
    (env.VERCEL_ENV ?? "").trim().toLowerCase() !== "production"
  );
}

/**
 * Whether this deployment may start an M-Pesa deposit.
 * - Against the real Daraja API (anything other than an explicit sandbox) the compliance flag
 *   `mpesa_live` must be on.
 * - Against the Daraja sandbox, only the sandbox gate matters, and `mpesa_live` is ignored so a
 *   mistaken live flag can never let fake sandbox money credit real wallets.
 */
export function mayStartMpesaPayment(liveFlag: boolean, env: Env = process.env): boolean {
  return isExplicitSandbox(env) ? isSandboxPaymentsEnabled(env) : liveFlag;
}
