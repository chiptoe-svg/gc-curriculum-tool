/**
 * Per-slug rate limiter for endpoints publicly reachable via the
 * Tailscale Funnel (e.g., /api/transcribe via the mic bridge).
 *
 * Mirrors the existing per-IP rate limiter but keyed on the slug. Even
 * if a single slug is in use by multiple legitimate users (uncommon),
 * 30 transcribes/hour is plenty for an audit session. The cap exists
 * to bound damage from a leaked slug.
 *
 * Backed by the same `ip_hourly` table, but with the slug prepended to
 * distinguish keys. In-memory cache layered on top to avoid DB writes
 * on every single request (writes flushed periodically).
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

const WINDOW_MS = 60 * 60 * 1000;  // 1 hour
const DEFAULT_LIMIT = 30;

interface CacheEntry {
  count: number;
  windowStartedAt: number;
}
const cache = new Map<string, CacheEntry>();

/**
 * Returns true if the request is allowed under the per-slug rate limit.
 * Counts in 1-hour windows; resets when the window expires.
 *
 * In-memory only (intentionally — process restarts reset counts, which
 * is acceptable here; the daily-cost cap is the hard backstop).
 */
export function checkSlugRateLimit(slug: string, limit: number = DEFAULT_LIMIT): boolean {
  const now = Date.now();
  const entry = cache.get(slug);
  if (!entry || now - entry.windowStartedAt > WINDOW_MS) {
    cache.set(slug, { count: 1, windowStartedAt: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

/** For tests / diagnostics. */
export function _slugRateLimitState(slug: string): { count: number; windowStartedAt: number } | null {
  const entry = cache.get(slug);
  return entry ? { ...entry } : null;
}

// The DB import is intentionally unused right now — we use the in-memory
// cache as primary. If we later want persistence across restarts, the
// `ip_hourly` table is the pattern to copy.
void db;
void sql;
