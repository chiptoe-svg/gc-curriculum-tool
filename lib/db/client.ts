import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// fetchConnectionCache is now `true` by default in @neondatabase/serverless;
// the previous `neonConfig.fetchConnectionCache = true` is deprecated and
// produces a warning on every cold start, so we omit it.

// Neon's HTTP SQL queries occasionally stall on a stale/dead keep-alive
// socket: the connection stays open but no response headers ever arrive, so
// undici's fetch hangs for its full 300s headers timeout — turning one unlucky
// query into a five-minute page hang.
//
// `fetchFunction` wraps every query fetch with a hard per-attempt timeout and
// retries. Retries fire only on connection-level failures (timeout / aborted /
// "fetch failed") — cases where the request almost certainly never reached a
// live query handler, so re-running it is safe. A SQL-level error comes back
// as a normal HTTP response, not a throw, so it never triggers a retry.
// Per-attempt timeouts. A stale socket never responds at all, so the first
// attempt is short — fail fast and retry on a fresh connection. Later attempts
// are generous enough to absorb a genuine Neon compute cold-start (~25s).
const ATTEMPT_TIMEOUTS_MS = [8_000, 25_000, 25_000];

function isRetriable(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  // TimeoutError/AbortError → our AbortSignal fired; TypeError → undici
  // "fetch failed" (dead socket, reset, DNS). All mean: no response received.
  return name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError';
}

neonConfig.fetchFunction = async (
  input: unknown,
  init: Record<string, unknown> = {},
): Promise<Response> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < ATTEMPT_TIMEOUTS_MS.length; attempt++) {
    try {
      return await fetch(input as RequestInfo, {
        ...init,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUTS_MS[attempt]!),
      });
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === ATTEMPT_TIMEOUTS_MS.length - 1;
      if (!isRetriable(err) || isLastAttempt) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr;
};

// Lazy initialization. Throwing at module import time crashes Next.js builds
// and any test that imports the module tree, even when those code paths don't
// touch the DB. Constructing the client on first access keeps imports safe.
let cached: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (cached) return cached;
  // Trim defensively — Vercel's env var UI sometimes preserves trailing
  // newlines from pasted values, and the neon driver puts the URL into an
  // HTTP header where CR/LF causes "invalid header value" errors.
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL not set');
  }
  cached = drizzle(neon(url), { schema });
  return cached;
}

// Proxy preserves the `db.select()...` call site without forcing every
// consumer to call a function. Each method access lazily initializes.
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
