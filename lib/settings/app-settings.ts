/**
 * Search settings an admin can override on /settings (spec 2026-11-20-settings-evidence).
 * The reranker override lives in app_settings ('search.rerank' = 'on' | 'off'); with no row, or if the
 * database can't be read, search follows the RERANK env switch (on unless RERANK=off).
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { appSettings } from '@/lib/db/schema';
import { rerankEnabled } from '@/lib/ai/rerank';

const RERANK_KEY = 'search.rerank';
const TTL_MS = 30_000;

export type RerankOverride = 'on' | 'off' | null;

let cache: { value: RerankOverride; at: number } | null = null;

export function clearSearchSettingsCache(): void {
  cache = null;
}

export async function getRerankOverride(): Promise<RerankOverride> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, RERANK_KEY));
  const v = rows[0]?.value;
  return v === 'on' || v === 'off' ? v : null;
}

export async function setRerankOverride(value: RerankOverride): Promise<void> {
  if (value === null) {
    await db.delete(appSettings).where(eq(appSettings.key, RERANK_KEY));
  } else {
    await db.insert(appSettings).values({ key: RERANK_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
  cache = null;
}

/** Whether search reranks now: the admin override, else the env switch. Cached 30 s; a read failure uses the env. */
export async function rerankEnabledNow(): Promise<boolean> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    try {
      cache = { value: await getRerankOverride(), at: Date.now() };
    } catch {
      return rerankEnabled();
    }
  }
  return cache.value === null ? rerankEnabled() : cache.value === 'on';
}
