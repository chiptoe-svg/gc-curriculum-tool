// Real-DB test: requires DATABASE_URL (see .env.local). Skips (not fails) when unset.
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { parseCourseCode } from '@/lib/courses/parse-course-code';

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)('course identity backfill matches the parser', () => {
  it("every course row's parsed parts equal parseCourseCode(code)", async () => {
    const rows = await db.select().from(courses);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const p = parseCourseCode(r.code);
      if (p.number === null) continue; // unparseable codes keep null — not backfilled
      expect({ prefix: r.prefix, number: r.courseNumber, suffix: r.numberSuffix })
        .toEqual({ prefix: p.prefix, number: p.number, suffix: p.suffix });
    }
  });
});
