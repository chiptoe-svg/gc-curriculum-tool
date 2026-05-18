import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

neonConfig.fetchConnectionCache = true;

// Lazy initialization. Throwing at module import time crashes Next.js builds
// and any test that imports the module tree, even when those code paths don't
// touch the DB. Constructing the client on first access keeps imports safe.
let cached: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
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
