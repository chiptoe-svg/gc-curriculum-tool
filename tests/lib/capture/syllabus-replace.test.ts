// Real-DB test: requires DATABASE_URL (a scratch DB, never live). Skips (not
// fails) when unset. A new syllabus fully replaces the older one in the same
// section: the old row is retired, set aside from the AI, and its chunks leave
// the course search index (owner 2026-11-06).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { courses, courseMaterials } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { insertMaterial } from '@/lib/db/course-materials-queries';
import { createInMemoryVectorStore, tenantForCourse, type VectorStore } from '@/lib/capture/vector-store';
import { supersedeOlderSyllabi, SUPERSEDED_REASON } from '@/lib/capture/syllabus-replace';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const CODE = 'ZZ 9300';
const LAB = 'ZZ 9301';

async function addSyllabus(fileName: string, sourceCode: string | null = null) {
  return insertMaterial({
    courseCode: CODE, fileName, blobUrl: 'local://x', mimeType: 'application/pdf',
    sizeBytes: 10, ipHash: 'test', sourceCode, isSyllabus: true,
  });
}

async function seedChunk(store: VectorStore, materialId: string) {
  await store.upsert(tenantForCourse(CODE), [{
    id: `${materialId}-c0`, vector: [1, 0], materialId, courseCode: CODE, fileName: 'f',
    sectionTitle: 's', sectionIndex: 0, parentSectionId: 'p', text: 'old objectives', contextBlurb: '',
  }]);
}

async function row(id: string) {
  const [r] = await db.select().from(courseMaterials).where(eq(courseMaterials.id, id));
  return r!;
}

async function chunkMaterialIds(store: VectorStore) {
  const hits = await store.hybridSearch(tenantForCourse(CODE), { queryVector: [1, 0], queryText: 'objectives', k: 10 });
  return hits.map(h => h.materialId);
}

describe.skipIf(!HAS_DB)('supersedeOlderSyllabi', () => {
  beforeEach(async () => {
    await db.delete(courseMaterials).where(eq(courseMaterials.courseCode, CODE));
    await db.insert(courses)
      .values({ code: CODE, title: 'Syllabus replace test', level: 9000, track: 'test' } as never)
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(courseMaterials).where(eq(courseMaterials.courseCode, CODE));
    await db.delete(courses).where(eq(courses.code, CODE));
  });

  it('retires the older syllabus, sets it aside from the AI and removes its chunks', async () => {
    const store = createInMemoryVectorStore();
    const old = await addSyllabus('Fall syllabus.pdf');
    await seedChunk(store, old.id);
    const fresh = await addSyllabus('Spring syllabus.pdf');

    const replaced = await supersedeOlderSyllabi(fresh, { store });

    expect(replaced).toEqual([old.id]);
    const o = await row(old.id);
    expect(o.retiredAt).not.toBeNull();
    expect(o.ignored).toBe(true);
    expect(o.setAsideReason).toBe(SUPERSEDED_REASON);
    expect(await chunkMaterialIds(store)).not.toContain(old.id);
    const f = await row(fresh.id);
    expect(f.retiredAt).toBeNull();
    expect(f.ignored).toBe(false);
  });

  it('leaves a paired lab section syllabus alone', async () => {
    const store = createInMemoryVectorStore();
    const lab = await addSyllabus('Canvas: Syllabus', LAB);
    const fresh = await addSyllabus('Spring syllabus.pdf');

    expect(await supersedeOlderSyllabi(fresh, { store })).toEqual([]);
    expect((await row(lab.id)).retiredAt).toBeNull();
  });

  it('brings back a syllabus this rule set aside when it is written again', async () => {
    const store = createInMemoryVectorStore();
    const canvas = await addSyllabus('Canvas: Syllabus');
    const upload = await addSyllabus('Spring syllabus.pdf');
    await supersedeOlderSyllabi(upload, { store });
    expect((await row(canvas.id)).ignored).toBe(true);

    // A later Canvas re-import refreshes the same row in place.
    await supersedeOlderSyllabi(await row(canvas.id), { store });

    const c = await row(canvas.id);
    expect(c.retiredAt).toBeNull();
    expect(c.ignored).toBe(false);
    expect(c.setAsideReason).toBeNull();
    expect((await row(upload.id)).retiredAt).not.toBeNull();
  });

  it('does not un-ignore a syllabus faculty set aside themselves', async () => {
    const store = createInMemoryVectorStore();
    const canvas = await addSyllabus('Canvas: Syllabus');
    await db.update(courseMaterials).set({ ignored: true, setAsideReason: 'PII detected' })
      .where(eq(courseMaterials.id, canvas.id));

    await supersedeOlderSyllabi(await row(canvas.id), { store });

    const c = await row(canvas.id);
    expect(c.ignored).toBe(true);
    expect(c.setAsideReason).toBe('PII detected');
  });

  it('does nothing for a material that is not a syllabus', async () => {
    const store = createInMemoryVectorStore();
    const old = await addSyllabus('Fall syllabus.pdf');
    const other = await insertMaterial({
      courseCode: CODE, fileName: 'Project brief.pdf', blobUrl: 'local://y', mimeType: 'application/pdf',
      sizeBytes: 10, ipHash: 'test',
    });

    expect(await supersedeOlderSyllabi(other, { store })).toEqual([]);
    expect((await row(old.id)).retiredAt).toBeNull();
  });
});
