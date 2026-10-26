// Standalone authentication primitives. Server-only: never import into browser bundles.
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import postgres from "postgres";
import { getDb } from "@/lib/db.server";

const SESSION_COOKIE = "gc_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (![16_384, 32_768, 65_536].includes(N) || r !== 8 || p !== 1) return false;
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (salt.length < 16 || expected.length !== SCRYPT_KEY_BYTES) return false;
    const actual = await scryptAsync(password, salt, expected.length, {
      N, r, p, maxmem: 128 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const token = value.join("=");
      return /^[A-Za-z0-9_-]{40,100}$/.test(token) ? token : null;
    }
  }
  return null;
}

export function sessionCookie(token: string, request: Request): string {
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface StandaloneUser {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  kyc_status: string | null;
  is_active: boolean | null;
  roles: string[];
}

export async function getStandaloneSession(request: Request): Promise<StandaloneUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const db = getDb();
  const tokenHash = hashSessionToken(token);
  const rows = await db`
    SELECT u.id::text AS id, u.email, u.full_name,
           p.phone, p.kyc_status, p.is_active,
           COALESCE(array_agg(DISTINCT ur.role::text)
             FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]) AS roles
      FROM public.auth_sessions s
      JOIN public.app_users u ON u.id = s.user_id
      LEFT JOIN public.profiles p ON p.id = u.id
      LEFT JOIN public.user_roles ur ON ur.user_id = u.id
     WHERE s.token_hash = ${tokenHash}
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND u.is_disabled = false
       AND COALESCE(p.is_active, true) = true
     GROUP BY u.id, p.id
     LIMIT 1
  `;
  if (!rows[0]) return null;
  await db`UPDATE public.auth_sessions
               SET last_seen_at = now()
             WHERE token_hash = ${tokenHash}
               AND last_seen_at < now() - interval '5 minutes'`;
  return rows[0] as unknown as StandaloneUser;
}

export function authResponse(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export function normalizeKenyanPhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "254" + digits.slice(1);
  else if (digits.startsWith("7") || digits.startsWith("1")) digits = "254" + digits;
  return /^254[17]\d{8}$/.test(digits) ? digits : null;
}

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function requestUserAgent(request: Request): string | null {
  return request.headers.get("user-agent")?.slice(0, 500) ?? null;
}
