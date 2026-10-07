/**
 * Per-course ingest cooldown (security review F2, 2026-10-07).
 *
 * `runCourseIngest` is reachable by a single-course scoped grant, not just
 * the shared admin credential, and its only other limiter was the
 * per-IP rate limit (600/hr, shared across every route). Nothing stopped
 * the same course being re-ingested in a loop. This adds a floor: the same
 * canonical course code can trigger ingest at most once per `COOLDOWN_MS`.
 *
 * In-memory, process-local — acceptable here because the app runs as a
 * single Next.js process on one Mac (see docs/STATE.md "Architecture"); a
 * restart simply clears the cooldown, which is safe (fails open to "allowed"
 * rather than open to data loss).
 */

export const COOLDOWN_MS = 60_000;

const lastIngestStartedAt = new Map<string, number>();

export type CooldownResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Keyed by the CANONICAL course code — callers must canonicalize first
 * (see lib/curriculum/catalog-lookup.ts canonicalizeCourseCode) so a
 * case-variant of the same code can't bypass the cooldown. */
export function checkIngestCooldown(courseCode: string, now: number = Date.now()): CooldownResult {
  const last = lastIngestStartedAt.get(courseCode);
  if (last === undefined) return { allowed: true };
  const elapsed = now - last;
  if (elapsed >= COOLDOWN_MS) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil((COOLDOWN_MS - elapsed) / 1000) };
}

/** Call once a request has passed every other check and is about to start
 * ingesting — not before, so a request refused for another reason (bad
 * slug, invalid mode, over the daily cap) never consumes the window. */
export function recordIngestStart(courseCode: string, now: number = Date.now()): void {
  lastIngestStartedAt.set(courseCode, now);
}

/** Test seam — clears all cooldown state between tests. */
export function __resetIngestCooldownForTest(): void {
  lastIngestStartedAt.clear();
}
