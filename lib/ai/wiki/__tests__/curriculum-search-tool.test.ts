import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ai/embeddings', () => ({ embedText: vi.fn(async () => [1, 0, 0]) }));
const fakeStore = {
  hybridSearch: vi.fn(async () => ([
    { id: 'a', materialId: 'm', courseCode: 'GC 1000', fileName: 'f.pdf', sectionTitle: 'f.pdf',
      sectionIndex: 0, text: 'ink', parentSectionId: '', parentSectionText: null, contextBlurb: '',
      score: 0.9, uploadedAt: null, snapshotId: null },
  ])),
} as any;
vi.mock('@/lib/capture/vector-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/vector-store')>()),
  createVectorStore: () => fakeStore,
}));

import { diversifyByCourse, curriculumSearchTool } from '@/lib/ai/wiki/curriculum-search-tool';

const hit = (id: string, courseCode: string, score: number) =>
  ({ id, courseCode, score } as any);

describe('diversifyByCourse', () => {
  it('caps hits per course and preserves score order within a course', () => {
    const hits = [
      hit('a', 'GC 1000', 0.9), hit('b', 'GC 1000', 0.8), hit('c', 'GC 1000', 0.7),
      hit('d', 'GC 2000', 0.6),
    ];
    const out = diversifyByCourse(hits, 2);
    expect(out.filter(h => h.courseCode === 'GC 1000').map(h => h.id)).toEqual(['a', 'b']);
    expect(out.some(h => h.courseCode === 'GC 2000')).toBe(true);
  });
});

describe('search_curriculum tool', () => {
  it('embeds the query, searches the program tenant, returns citable hits', async () => {
    const res: any = await curriculumSearchTool.execute({ query: 'ink mixing' });
    expect(fakeStore.hybridSearch).toHaveBeenCalledWith('coursecapture-program', expect.objectContaining({ queryText: 'ink mixing' }));
    expect(res.hits[0]).toMatchObject({ courseCode: 'GC 1000', fileName: 'f.pdf' });
  });

  it('passes courseCode through for drill-down', async () => {
    await curriculumSearchTool.execute({ query: 'x', courseCode: 'GC 2000' });
    expect(fakeStore.hybridSearch).toHaveBeenLastCalledWith('coursecapture-program', expect.objectContaining({ courseCode: 'GC 2000' }));
  });
});
