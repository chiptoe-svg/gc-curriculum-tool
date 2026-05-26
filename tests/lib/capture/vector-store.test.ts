import { describe, it, expect } from 'vitest';
import { createInMemoryVectorStore, tenantForCourse, type ChunkVectorRecord } from '@/lib/capture/vector-store';

const make = (id: string, vector: number[], over: Partial<ChunkVectorRecord> = {}): ChunkVectorRecord => ({
  id,
  vector,
  materialId: 'm1',
  courseCode: 'GC 4800',
  fileName: 'x.md',
  sectionTitle: 's',
  sectionIndex: 0,
  parentSectionId: 'ps',
  text: 'hello',
  contextBlurb: '',
  ...over,
});

describe('tenantForCourse', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(tenantForCourse('GC 4800')).toBe('coursecapture-gc-4800');
    expect(tenantForCourse('GC  3460')).toBe('coursecapture-gc-3460');
  });
});

describe('InMemoryVectorStore', () => {
  it('upserts and searches by cosine similarity within a tenant', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert('coursecapture-gc-4800', [
      make('a', [1, 0, 0], { text: 'east' }),
      make('b', [0, 1, 0], { text: 'north' }),
    ]);
    const hits = await store.hybridSearch('coursecapture-gc-4800', {
      queryVector: [1, 0, 0],
      queryText: 'east',
      k: 2,
    });
    expect(hits[0]!.id).toBe('a');
    expect(hits[0]!.text).toBe('east');
  });

  it('isolates tenants — upserts in tenant A are not searchable in tenant B', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert('tenantA', [make('a', [1, 0, 0])]);
    const hits = await store.hybridSearch('tenantB', { queryVector: [1, 0, 0], queryText: 'anything', k: 5 });
    expect(hits).toEqual([]);
  });

  it('overwrites a record when the same id is upserted twice', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert('t', [make('a', [1, 0, 0], { text: 'first' })]);
    await store.upsert('t', [make('a', [0, 1, 0], { text: 'second' })]);
    const hits = await store.hybridSearch('t', { queryVector: [0, 1, 0], queryText: 'second', k: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.text).toBe('second');
  });

  it('deletes by materialId', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert('t', [
      make('a', [1, 0, 0], { materialId: 'm1' }),
      make('b', [0, 1, 0], { materialId: 'm2' }),
    ]);
    await store.deleteByMaterial('t', 'm1');
    const hits = await store.hybridSearch('t', { queryVector: [1, 0, 0], queryText: 'x', k: 5 });
    expect(hits.map(h => h.materialId)).toEqual(['m2']);
  });

  it('search returns parent section text when present', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert('t', [make('a', [1, 0, 0], { text: 'detail', parentSectionId: 'ps1' })]);
    await store.upsertSections('t', [{
      id: 'ps1',
      materialId: 'm1',
      title: 'Section title',
      index: 0,
      text: 'full section body',
    }]);
    const hits = await store.hybridSearch('t', { queryVector: [1, 0, 0], queryText: 'detail', k: 1 });
    expect(hits[0]!.parentSectionText).toBe('full section body');
  });

  it('restricts search to one materialId when provided', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert('t', [
      make('a', [1, 0, 0], { materialId: 'm1', text: 'from m1' }),
      make('b', [1, 0, 0], { materialId: 'm2', text: 'from m2' }),
    ]);
    const hits = await store.hybridSearch('t', { queryVector: [1, 0, 0], queryText: 'x', k: 5, materialId: 'm1' });
    expect(hits.map(h => h.materialId)).toEqual(['m1']);
  });
});
