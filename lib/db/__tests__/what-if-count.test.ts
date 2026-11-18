// @vitest-environment node
// countWhatIfsByCourse agrees with the /explore/<code> list: what-ifs with a page and skills-only ones (from a cluster)
// are counted; a draft with neither is not.
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureSnapshots, courseWhatIfs } from '@/lib/db/schema';
import { countWhatIfsByCourse } from '@/lib/db/what-if-queries';

const CODE = 'GC ZZ8';
const onScratch = (() => { try { return new URL(process.env.DATABASE_URL ?? '').pathname === '/gc_curriculum_builder_scratch'; } catch { return false; } })();

describe.runIf(onScratch)('countWhatIfsByCourse (scratch DB)', () => {
  const cleanup = async () => {
    await db.delete(courseWhatIfs).where(eq(courseWhatIfs.courseCode, CODE));
    await db.delete(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.courseCode, CODE));
    await db.delete(courses).where(eq(courses.code, CODE));
  };
  afterAll(cleanup);

  it('counts skills-only what-ifs, not drafts without a page', async () => {
    await cleanup();
    await db.insert(courses).values({ code: CODE, title: 'Test', level: 1, track: 'core', scope: 'gc', status: 'offered' } as never);
    const [snap] = await db.insert(courseCaptureSnapshots).values({
      courseCode: CODE, profile: {}, inputsMeta: {}, scaleVersion: 'v1', model: 'test', instructorName: 'T',
    } as never).returning({ id: courseCaptureSnapshots.id });
    const base = { courseCode: CODE, baseSnapshotId: snap!.id, ownerGrantId: 'g', ownerKind: 'personal', authorName: 'A' };
    await db.insert(courseWhatIfs).values([
      { ...base, title: `${CODE} as edited on X`, skills: { objectives: [], developed: [], required: [], fromCluster: null } },
      { ...base }, // a draft: no page, no skills
    ] as never);
    expect((await countWhatIfsByCourse()).get(CODE)).toBe(1);
  });
});
