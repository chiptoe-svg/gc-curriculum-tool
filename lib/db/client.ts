import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Local Postgres 17 via Postgres.app (launchd com.gc.postgres on :5433,
// db `gc_curriculum`). The earlier Neon serverless driver is gone — see
// 2026-06-04 migration. Connection pool sized for a single-Mac dev/prod
// server: ~10 concurrent queries is plenty.
const POOL_MAX = 10;
const IDLE_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 10_000;

let pool: Pool | null = null;
let cached: NodePgDatabase<typeof schema> | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL not set');
  pool = new Pool({
    connectionString: url,
    max: POOL_MAX,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  pool.on('error', (err) => {
    // node-postgres emits 'error' on idle clients (e.g., server restart);
    // log + let the next checkout retry. Don't crash the process.
    console.error('[db] idle client error:', err.message);
  });
  return pool;
}

function getDb(): NodePgDatabase<typeof schema> {
  if (cached) return cached;
  cached = drizzle(getPool(), { schema });
  return cached;
}

// Proxy preserves the `db.select()...` call site without forcing every
// consumer to call a function. Each method access lazily initializes.
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
