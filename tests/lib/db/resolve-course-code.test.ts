import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * G2 (security re-review, 2026-10-07): the ingest/reset routes used to
 * blindly lower-case the course-code suffix via canonicalizeCourseCode,
 * which breaks any live course whose stored code has an upper-case suffix
 * (e.g. GC 1010L) — the exact string no longer matches, so ingest 404s and
 * reset silently "succeeds" while deleting nothing. The fix resolves the
 * PATH segment against the DB case-insensitively and uses the STORED
 * spelling everywhere, instead of guessing a canonical form.
 */

let selectResult: Array<{ code: string }> = [];

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResult,
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/db/schema', () => ({ courses: { code: 'code' } }));

import { resolveCourseCodeCaseInsensitive } from '@/lib/db/courses-queries';

describe('resolveCourseCodeCaseInsensitive', () => {
  beforeEach(() => { selectResult = []; });

  it('returns the stored spelling when a case-insensitive match exists', async () => {
    selectResult = [{ code: 'GC 1010L' }];
    const out = await resolveCourseCodeCaseInsensitive('gc 1010l');
    expect(out).toBe('GC 1010L');
  });

  it('returns null when no course matches', async () => {
    selectResult = [];
    const out = await resolveCourseCodeCaseInsensitive('GC 9999');
    expect(out).toBeNull();
  });
});
