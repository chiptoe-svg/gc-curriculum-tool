// Real-DB test: requires DATABASE_URL. Skips (not fails) when unset.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseCodes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { addPairedCode, listPairedCodes } from '@/lib/db/course-codes-queries';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const PRIMARY = 'ZZ 9100';

describe.skipIf(!HAS_DB)('course-codes queries', () => {
  beforeAll(async () => {
    await db.insert(courses).values({ code: PRIMARY, title: 'Pair test', level: 9000, track: 'test' } as never).onConflictDoNothing();
  });
  afterAll(async () => {
    await db.delete(courseCodes).where(eq(courseCodes.courseCode, PRIMARY));
    await db.delete(courses).where(eq(courses.code, PRIMARY));
  });
  it('adds a paired code and lists it by primary', async () => {
    await addPairedCode({ courseCode: PRIMARY, pairedCode: 'ZZ 9101', role: 'lab' });
    const paired = await listPairedCodes(PRIMARY);
    expect(paired.map(p => p.pairedCode)).toEqual(['ZZ 9101']);
    expect(paired[0]!.role).toBe('lab');
  });
});
