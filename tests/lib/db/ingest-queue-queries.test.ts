// Real-DB test: requires DATABASE_URL. Skips (not fails) when unset.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseMaterials } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { insertMaterial, updateIndexingStatus, claimNextQueued, resetStuckIndexing } from '@/lib/db/course-materials-queries';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const CODE = 'ZZ 9999';

async function seed(status: 'queued' | 'indexing'): Promise<string> {
  const row = await insertMaterial({
    courseCode: CODE, fileName: 'f.pdf', blobUrl: '/api/storage/materials/zz-9999/f.pdf',
    mimeType: 'application/pdf', sizeBytes: 10, ipHash: 'h',
  });
  await updateIndexingStatus({ id: row.id, status });
  return row.id;
}

describe.skipIf(!HAS_DB)('ingest queue queries', () => {
  beforeAll(async () => {
    await db.insert(courses).values({ code: CODE, title: 'Queue test', level: 9000, track: 'test' } as never).onConflictDoNothing();
  });
  afterAll(async () => {
    await db.delete(courseMaterials).where(eq(courseMaterials.courseCode, CODE));
    await db.delete(courses).where(eq(courses.code, CODE));
  });
  beforeEach(async () => {
    await db.delete(courseMaterials).where(eq(courseMaterials.courseCode, CODE));
  });

  it('claimNextQueued returns one queued row and flips it to indexing', async () => {
    const id = await seed('queued');
    const claimed = await claimNextQueued();
    expect(claimed?.id).toBe(id);
    expect(claimed?.indexingStatus).toBe('indexing');
    expect(await claimNextQueued()).toBeNull();
  });

  it('two concurrent claims never return the same row', async () => {
    await seed('queued');
    await seed('queued');
    const [a, b] = await Promise.all([claimNextQueued(), claimNextQueued()]);
    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a!.id).not.toBe(b!.id);
  });

  it('resetStuckIndexing re-queues rows left indexing', async () => {
    const id = await seed('indexing');
    const n = await resetStuckIndexing();
    expect(n).toBeGreaterThanOrEqual(1);
    const claimed = await claimNextQueued();
    expect(claimed?.id).toBe(id);
  });
});
