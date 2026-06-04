import { fetchCourseTabCsv } from './fetchSheet';
import { parseCourseTab } from './parseCourseTab';
import type { ParsedCourse } from './parseCourseTab';

/**
 * Server-side helper for `/view/<code>` catalog fallback: pull the course's
 * tab from the Google Sheet at request time so faculty edits in the Sheet
 * appear instantly without waiting for a re-seed.
 *
 * Caches per-course for 60s in-process to avoid hammering Google on
 * adjacent requests. Returns `null` on any failure (sheet id unset,
 * tab missing, network/timeout, parse error) — callers fall back to
 * the DB row in that case.
 *
 * `pnpm db:seed-courses` remains the canonical sync path for non-view
 * surfaces (capture, explore, program coverage). This helper is
 * deliberately read-only and view-scoped.
 */

interface CacheEntry {
  value: ParsedCourse | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const cache = new Map<string, CacheEntry>();

export async function fetchLiveCourseFromSheet(courseCode: string): Promise<ParsedCourse | null> {
  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!sheetId) return null;

  const cached = cache.get(courseCode);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let csv: string;
    try {
      csv = await fetchCourseTabCsv(sheetId, courseCode);
    } finally {
      clearTimeout(timer);
    }
    if (ac.signal.aborted) throw new Error('timeout');
    if (!csv || csv.trim().length === 0) {
      cache.set(courseCode, { value: null, fetchedAt: Date.now() });
      return null;
    }
    const parsed = parseCourseTab(csv);
    cache.set(courseCode, { value: parsed, fetchedAt: Date.now() });
    return parsed;
  } catch (err) {
    // Failure shouldn't break the page — log and let the caller fall back.
    console.warn(`[fetchLiveCourseFromSheet] ${courseCode}: ${err instanceof Error ? err.message : err}`);
    cache.set(courseCode, { value: null, fetchedAt: Date.now() });
    return null;
  }
}
