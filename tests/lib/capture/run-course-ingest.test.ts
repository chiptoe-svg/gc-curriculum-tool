import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * F2 (security review, 2026-10-07): a row already 'queued' or 'indexing'
 * must NOT be re-enqueued by a repeat ingest call — re-queuing in-flight
 * rows meant every "Index now" / Triage click (now reachable by a
 * single-course scoped grant, not just the shared admin credential) could
 * re-run paid extraction/vision/digest work on the same row.
 */
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn(async () => {}) }));
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue }));
vi.mock('@/lib/db/schema', () => ({ courseMaterials: {}, courses: {} }));

type Row = { id: string; fileName: string; indexingStatus: string | null; extractedText: string | null; blobUrl: string; ignored: boolean };

let materials: Row[] = [];
let courseExists = true;

// runCourseIngest makes two db.select() calls in order: (1) the course
// existence check, chain ending with .limit(), (2) the materials list,
// awaited directly at .where() — same shape the v2-backfill route test
// documents. A module-scope counter distinguishes them.
let selectCallCount = 0;
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => {
      selectCallCount++;
      const callIndex = selectCallCount;
      if (callIndex === 1) {
        return { from: () => ({ where: () => ({ limit: async () => (courseExists ? [{ code: 'GC 1010' }] : []) }) }) };
      }
      return { from: () => ({ where: () => Promise.resolve(materials) }) };
    },
  },
}));

import { runCourseIngest } from '@/lib/capture/run-course-ingest';

describe('runCourseIngest — skips already in-flight rows (F2)', () => {
  beforeEach(() => {
    enqueue.mockClear();
    selectCallCount = 0;
    courseExists = true;
    materials = [];
  });

  it("skips a row already 'queued' without calling enqueue", async () => {
    materials = [{ id: 'm1', fileName: 'q.pdf', indexingStatus: 'queued', extractedText: 'x', blobUrl: '', ignored: false }];
    const result = await runCourseIngest('GC 1010', { mode: 'hybrid' });
    expect(result?.results).toEqual([{ id: 'm1', fileName: 'q.pdf', status: 'skipped' }]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skips a row already 'indexing' without calling enqueue", async () => {
    materials = [{ id: 'm2', fileName: 'i.pdf', indexingStatus: 'indexing', extractedText: 'x', blobUrl: '', ignored: false }];
    const result = await runCourseIngest('GC 1010', { mode: 'hybrid' });
    expect(result?.results).toEqual([{ id: 'm2', fileName: 'i.pdf', status: 'skipped' }]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still queues a 'pending' row with text", async () => {
    materials = [{ id: 'm3', fileName: 'p.pdf', indexingStatus: 'pending', extractedText: 'x', blobUrl: '', ignored: false }];
    const result = await runCourseIngest('GC 1010', { mode: 'hybrid' });
    expect(result?.results).toEqual([{ id: 'm3', fileName: 'p.pdf', status: 'queued' }]);
    expect(enqueue).toHaveBeenCalledWith('m3', { ingestProvider: null });
  });

  it("still skips an already-'ready' row (unchanged prior behavior)", async () => {
    materials = [{ id: 'm4', fileName: 'r.pdf', indexingStatus: 'ready', extractedText: 'x', blobUrl: '', ignored: false }];
    const result = await runCourseIngest('GC 1010', { mode: 'hybrid' });
    expect(result?.results).toEqual([{ id: 'm4', fileName: 'r.pdf', status: 'skipped' }]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('handles a mixed batch correctly: only the pending row is queued', async () => {
    materials = [
      { id: 'q', fileName: 'q.pdf', indexingStatus: 'queued', extractedText: 'x', blobUrl: '', ignored: false },
      { id: 'i', fileName: 'i.pdf', indexingStatus: 'indexing', extractedText: 'x', blobUrl: '', ignored: false },
      { id: 'p', fileName: 'p.pdf', indexingStatus: 'pending', extractedText: 'x', blobUrl: '', ignored: false },
      { id: 'r', fileName: 'r.pdf', indexingStatus: 'ready', extractedText: 'x', blobUrl: '', ignored: false },
    ];
    const result = await runCourseIngest('GC 1010', { mode: 'hybrid' });
    expect(result?.queued).toBe(1);
    expect(result?.skipped).toBe(3);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith('p', { ingestProvider: null });
  });
});
