// Real-DB test: requires DATABASE_URL. Skips (not fails) when unset.
// Proves that findMaterialByFileName is source-scoped: two rows with the same
// (courseCode, fileName) but different sourceCode values are distinct and the
// lookup returns the correct one for each sourceCode.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseMaterials } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { insertMaterial, findMaterialByFileName } from '@/lib/db/course-materials-queries';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const PRIMARY = 'ZZ 9200';
const LAB_SOURCE = 'ZZ 9201';
const FILE_NAME = 'Canvas: Assignments';

describe.skipIf(!HAS_DB)('findMaterialByFileName: source-scoped upsert identity', () => {
  beforeAll(async () => {
    // Seed the primary course row so the FK in course_materials is satisfied.
    await db
      .insert(courses)
      .values({ code: PRIMARY, title: 'Source scope test', level: 9000, track: 'test' } as never)
      .onConflictDoNothing();
  });

  afterAll(async () => {
    // Clean up in FK order: materials first, then course.
    await db.delete(courseMaterials).where(eq(courseMaterials.courseCode, PRIMARY));
    await db.delete(courses).where(eq(courses.code, PRIMARY));
  });

  it('null-source and lab-source rows are distinct and looked up independently', async () => {
    // Insert the "lecture" row — no sourceCode (primary/legacy, sourceCode IS NULL).
    const lectureRow = await insertMaterial({
      courseCode: PRIMARY,
      fileName: FILE_NAME,
      blobUrl: 'https://canvas.example.com/lecture',
      mimeType: 'text/html',
      sizeBytes: 100,
      ipHash: 'test-hash',
      sourceCode: null,
    });

    // Insert the "lab" row — same (courseCode, fileName) but different sourceCode.
    const labRow = await insertMaterial({
      courseCode: PRIMARY,
      fileName: FILE_NAME,
      blobUrl: 'https://canvas.example.com/lab',
      mimeType: 'text/html',
      sizeBytes: 200,
      ipHash: 'test-hash',
      sourceCode: LAB_SOURCE,
    });

    // Confirm the two rows have distinct ids (coexist, did not collide).
    expect(lectureRow.id).not.toBe(labRow.id);

    // findMaterialByFileName(code, name) → null-source default → returns lecture row.
    const foundNull = await findMaterialByFileName(PRIMARY, FILE_NAME);
    expect(foundNull).not.toBeNull();
    expect(foundNull!.id).toBe(lectureRow.id);

    // findMaterialByFileName(code, name, LAB_SOURCE) → returns lab row.
    const foundLab = await findMaterialByFileName(PRIMARY, FILE_NAME, LAB_SOURCE);
    expect(foundLab).not.toBeNull();
    expect(foundLab!.id).toBe(labRow.id);

    // The two returned rows are genuinely different.
    expect(foundNull!.id).not.toBe(foundLab!.id);
  });
});
