// Cross-course recall eval (Task 12). Measures retrieval recall + per-course
// diversification separately from generation, using the in-memory store so it
// runs in CI without Weaviate.
//
// For a REAL recall check: run the admin rebuild (POST /api/admin/program-index/rebuild),
// then query the live `program` tenant with VECTOR_STORE=weaviate and a handful of
// known cross-course concepts (e.g. color management, prepress, typography),
// confirming the expected courses appear. This in-memory test guards the
// retrieval + diversification LOGIC; the live check guards embedding/recall QUALITY.
import { describe, it, expect } from 'vitest';
import { createInMemoryVectorStore, tenantForProgram, type ChunkVectorRecord } from '@/lib/capture/vector-store';
import { diversifyByCourse } from '@/lib/ai/wiki/curriculum-search-tool';

const v = { color: [1, 0, 0], typography: [0, 1, 0], press: [0, 0, 1] };
function c(id: string, course: string, vec: number[]): ChunkVectorRecord {
  return { id, vector: vec, materialId: id, courseCode: course, fileName: `${id}.pdf`,
    sectionTitle: `${id}.pdf`, sectionIndex: 0, parentSectionId: '', text: id, contextBlurb: '',
    uploadedAt: null, snapshotId: null };
}

describe('cross-course recall eval', () => {
  it('a recurring concept surfaces from multiple courses', async () => {
    const s = createInMemoryVectorStore();
    await s.upsert(tenantForProgram(), [
      c('color-a', 'GC 1000', v.color), c('color-b', 'GC 2000', v.color),
      c('color-c', 'GC 3000', v.color), c('typo-a', 'GC 1000', v.typography),
    ]);
    const raw = await s.hybridSearch(tenantForProgram(), { queryVector: v.color, queryText: 'color management', k: 20 });
    const diversified = diversifyByCourse(raw, 1);
    const courses = new Set(diversified.map(h => h.courseCode));
    expect(courses.size).toBeGreaterThanOrEqual(3);
    expect(diversified.every(h => h.text.startsWith('color'))).toBe(true);
  });
});
