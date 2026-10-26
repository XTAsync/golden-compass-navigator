// Server-only PostgreSQL connection pool. Do not import this module from browser code.
import postgres, { type Sql } from "postgres";

let client: Sql | undefined;

export function getDb(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for the standalone PostgreSQL backend.");
  }

  if (!client) {
    const configuredMax = Number(process.env.DB_POOL_MAX ?? 10);
    const max = Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 30
      ? configuredMax
      : 10;

    client = postgres(url, {
      max,
      idle_timeout: 20,
      connect_timeout: 10,
      // Avoid prepared-statement issues on pooled/serverless PostgreSQL proxies.
      prepare: false,
      onnotice: () => {},
    });
  }

  return client;
}

/** Close the pool for tests or graceful process shutdown. */
export async function closeDb(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  await current.end({ timeout: 5 });
}
