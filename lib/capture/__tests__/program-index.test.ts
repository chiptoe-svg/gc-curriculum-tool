import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInMemoryVectorStore, tenantForCourse, tenantForProgram, type ChunkVectorRecord } from '@/lib/capture/vector-store';

const listIndexable = vi.fn();
vi.mock('@/lib/db/course-materials-queries', () => ({
  listIndexableMaterialsForCourse: (...a: unknown[]) => listIndexable(...a),
}));

import { refreshProgramIndex } from '@/lib/capture/program-index';

function chunk(over: Partial<ChunkVectorRecord>): ChunkVectorRecord {
  return { id: 'c', vector: [1, 0], materialId: 'm1', courseCode: 'GC 3460', fileName: 'f.pdf',
    sectionTitle: 'f.pdf', sectionIndex: 0, parentSectionId: 's', text: 't', contextBlurb: '',
    uploadedAt: null, snapshotId: null, ...over };
}

describe('refreshProgramIndex', () => {
  beforeEach(() => listIndexable.mockReset());

  it('copies only current materials, stamps provenance, into the program tenant', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert(tenantForCourse('GC 3460'), [
      chunk({ id: 'a', materialId: 'm_keep' }),
      chunk({ id: 'b', materialId: 'm_old', text: 'ink mixing' }),
    ]);
    listIndexable.mockResolvedValue([{ id: 'm_keep', uploadedAt: new Date('2026-03-01T00:00:00Z') }]);

    await refreshProgramIndex('GC 3460', { store, snapshotId: 'snap-1' });

    const inProgram = await store.listChunksByCourse(tenantForProgram(), 'GC 3460');
    expect(inProgram.map(c => c.materialId)).toEqual(['m_keep']);
    expect(inProgram[0]!.snapshotId).toBe('snap-1');
    expect(inProgram[0]!.uploadedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('is idempotent (delete-then-write leaves no stale slice)', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert(tenantForCourse('GC 3460'), [chunk({ id: 'a', materialId: 'm_keep' })]);
    listIndexable.mockResolvedValue([{ id: 'm_keep', uploadedAt: new Date('2026-03-01T00:00:00Z') }]);
    await refreshProgramIndex('GC 3460', { store, snapshotId: 's' });
    await refreshProgramIndex('GC 3460', { store, snapshotId: 's' });
    const inProgram = await store.listChunksByCourse(tenantForProgram(), 'GC 3460');
    expect(inProgram.length).toBe(1);
  });
});
