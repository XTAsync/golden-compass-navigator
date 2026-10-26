/**
 * Validates that all required environment variables are present.
 * Call this at server startup to fail fast with clear error messages.
 */

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
}

const ENV_VARS: EnvVar[] = [
  // Supabase (required during the migration; remove after all call sites are migrated)
  { name: "SUPABASE_URL", required: true, description: "Supabase project URL" },
  { name: "SUPABASE_PUBLISHABLE_KEY", required: true, description: "Supabase anon/publishable key" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, description: "Supabase service role key (server-side only)" },

  // M-Pesa (required for payment features)
  { name: "MPESA_CONSUMER_KEY", required: false, description: "Safaricom Daraja consumer key" },
  { name: "MPESA_CONSUMER_SECRET", required: false, description: "Safaricom Daraja consumer secret" },
  { name: "MPESA_SHORTCODE", required: false, description: "M-Pesa business shortcode" },
  { name: "MPESA_PASSKEY", required: false, description: "M-Pesa STK Push passkey" },
  { name: "MPESA_CALLBACK_URL", required: false, description: "Public URL for M-Pesa callbacks" },
  { name: "MPESA_ENV", required: false, description: "M-Pesa environment: sandbox or production" },

  // M-Pesa B2C (required for withdrawals)
  { name: "MPESA_INITIATOR_NAME", required: false, description: "B2C initiator name" },
  { name: "MPESA_SECURITY_CREDENTIAL", required: false, description: "B2C encrypted security credential" },
  { name: "MPESA_B2C_SHORTCODE", required: false, description: "B2C shortcode" },

  // Market data / broker (optional — without these, live mode falls back to the mock broker)
  { name: "MYSTOCKS_API_KEY", required: false, description: "mystocks.africa partner API key (African exchanges) — read in src/lib/market.server.ts" },
  { name: "FINNHUB_API_KEY", required: false, description: "Finnhub API key (global quotes) — read in src/lib/market.server.ts" },
];

export function validateEnv(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const v of ENV_VARS) {
    const value = process.env[v.name];
    if (!value || value.trim() === "") {
      if (v.required) {
        errors.push(`Missing required env var: ${v.name} — ${v.description}`);
      } else {
        warnings.push(`Missing optional env var: ${v.name} — ${v.description}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Log validation results at startup. Throws if required vars are missing.
 */
export function assertEnv(): void {
  const { valid, errors, warnings } = validateEnv();

  if (warnings.length > 0) {
    console.warn("[env] Warnings:");
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  if (!valid) {
    console.error("[env] FATAL — Missing required environment variables:");
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    throw new Error(`Server startup failed: ${errors.length} required env var(s) missing.`);
  }

  console.log("[env] All required environment variables present ✓");
}
