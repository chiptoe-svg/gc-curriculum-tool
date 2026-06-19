import { describe, it, expect } from 'vitest';
import { createInMemoryVectorStore, type ChunkVectorRecord } from '@/lib/capture/vector-store';

function chunk(over: Partial<ChunkVectorRecord>): ChunkVectorRecord {
  return {
    id: 'c1', vector: [1, 0, 0], materialId: 'm1', courseCode: 'GC 1000',
    fileName: 'f.pdf', sectionTitle: 'f.pdf', sectionIndex: 0, parentSectionId: 's1',
    text: 'ink mixing', contextBlurb: '', uploadedAt: null, snapshotId: null, ...over,
  };
}

describe('in-memory vector store — cross-course', () => {
  it('filters hybridSearch by courseCode', async () => {
    const s = createInMemoryVectorStore();
    await s.upsert('program', [chunk({ id: 'a', courseCode: 'GC 1000' }), chunk({ id: 'b', courseCode: 'GC 2000', vector: [1, 0, 0] })]);
    const hits = await s.hybridSearch('program', { queryVector: [1, 0, 0], queryText: 'ink', k: 10, courseCode: 'GC 2000' });
    expect(hits.map(h => h.id)).toEqual(['b']);
    expect(hits[0]!.courseCode).toBe('GC 2000');
  });

  it('deleteByCourse removes only that course', async () => {
    const s = createInMemoryVectorStore();
    await s.upsert('program', [chunk({ id: 'a', courseCode: 'GC 1000' }), chunk({ id: 'b', courseCode: 'GC 2000' })]);
    await s.deleteByCourse('program', 'GC 1000');
    const remaining = await s.listChunksByCourse('program', 'GC 2000');
    expect(remaining.map(c => c.id)).toEqual(['b']);
    expect(await s.listChunksByCourse('program', 'GC 1000')).toEqual([]);
  });
});
