import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, facultyFlags } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createFlag, listFlags, resolveFlag } from '@/lib/db/flag-queries';

const TEST_CODE = 'ZZ 9999'; // never a real course

beforeAll(async () => {
  await db.insert(courses).values({ code: TEST_CODE, title: 'Flag test course', level: 9000, track: 'test' }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(facultyFlags).where(eq(facultyFlags.courseCode, TEST_CODE));
  await db.delete(courses).where(eq(courses.code, TEST_CODE));
});

describe('flag-queries round trip', () => {
  it('creates, lists, and resolves a profile flag', async () => {
    const created = await createFlag({
      targetKind: 'profile_competency',
      courseCode: TEST_CODE,
      careerTargetId: null,
      subCompetencyId: null,
      competencyStatement: 'Test statement',
      note: 'AI overstated this',
      flaggedBy: 'Erica Walker',
      flaggedContext: { k: 3, u: 2, d: 4 },
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('open');

    const open = await listFlags({ status: 'open' });
    expect(open.some(fl => fl.id === created.id)).toBe(true);

    const resolved = await resolveFlag(created.id, { resolvedBy: 'Chip Tonkin', resolutionNote: 're-scored, agree now' });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('Chip Tonkin');
    expect(resolved.resolvedAt).toBeTruthy();

    const openAfter = await listFlags({ status: 'open' });
    expect(openAfter.some(fl => fl.id === created.id)).toBe(false);
    const all = await listFlags({});
    expect(all.some(fl => fl.id === created.id)).toBe(true);
  });

  it('rejects double-resolve', async () => {
    const created = await createFlag({
      targetKind: 'coverage_cell',
      courseCode: TEST_CODE,
      careerTargetId: null, // DB allows null; route-layer enforces the consistency rule
      subCompetencyId: null,
      competencyStatement: null,
      note: 'depth too high',
      flaggedBy: 'Erica Walker',
      flaggedContext: null,
    });
    await resolveFlag(created.id, { resolvedBy: 'Chip Tonkin', resolutionNote: 'done' });
    await expect(
      resolveFlag(created.id, { resolvedBy: 'Chip Tonkin', resolutionNote: 'again' }),
    ).rejects.toThrow(/already resolved/i);
  });
});
