import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// fetchConnectionCache is now `true` by default in @neondatabase/serverless;
// the previous `neonConfig.fetchConnectionCache = true` is deprecated and
// produces a warning on every cold start, so we omit it.

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
