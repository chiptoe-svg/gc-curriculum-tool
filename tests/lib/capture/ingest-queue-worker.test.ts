import { describe, it, expect, vi, beforeEach } from 'vitest';

const { claimNextQueued, resetStuckIndexing, updateIndexingStatus, processMaterial } = vi.hoisted(() => ({
  claimNextQueued: vi.fn(),
  resetStuckIndexing: vi.fn(),
  updateIndexingStatus: vi.fn(),
  processMaterial: vi.fn(),
}));

vi.mock('@/lib/db/course-materials-queries', () => ({ claimNextQueued, resetStuckIndexing, updateIndexingStatus }));
vi.mock('@/lib/capture/finalize-extraction', () => ({ finalizeExtraction: vi.fn() }));
vi.mock('@/lib/storage/local-storage', () => ({ readLocal: vi.fn(), keyFromLocalUrl: vi.fn() }));
vi.mock('@/lib/courses/extract-text', () => ({ extractText: vi.fn() }));
vi.mock('@/lib/capture/vector-store', () => ({ createVectorStore: vi.fn(), tenantForCourse: (c: string) => c }));

import * as queue from '@/lib/capture/ingest-queue';
// vi.spyOn does not intercept the internal _process binding, so we use the
// explicit test seam __setProcessForTest to route drain-loop calls through
// our hoisted mock while keeping processMaterial as the production export.

const { enqueue, __resetWorkerForTest, __setProcessForTest } = queue;
const row = (id: string) => ({ id, courseCode: 'GC 2400', fileName: `${id}.pdf`, blobUrl: `/x/${id}`, extractedText: 't', extractionStatus: 'ok' });

beforeEach(() => {
  vi.clearAllMocks();
  __resetWorkerForTest();
  // Route the drain loop through our hoisted mock so assertions work.
  __setProcessForTest(processMaterial as unknown as Parameters<typeof __setProcessForTest>[0]);
  resetStuckIndexing.mockResolvedValue(0);
  updateIndexingStatus.mockResolvedValue(undefined);
  processMaterial.mockResolvedValue(undefined);
});

describe('ingest worker', () => {
  it('runs boot recovery once before draining', async () => {
    claimNextQueued.mockResolvedValue(null);
    await enqueue('m1');
    await vi.waitFor(() => expect(resetStuckIndexing).toHaveBeenCalledTimes(1));
  });

  it('drains all queued rows then idles', async () => {
    claimNextQueued.mockResolvedValueOnce(row('a')).mockResolvedValueOnce(row('b')).mockResolvedValue(null);
    await enqueue('a');
    await vi.waitFor(() => expect(processMaterial).toHaveBeenCalledTimes(2));
  });

  it('never exceeds MAX_CONCURRENCY in flight', async () => {
    let inFlight = 0; let maxSeen = 0;
    processMaterial.mockImplementation(async () => {
      inFlight++; maxSeen = Math.max(maxSeen, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
    });
    const rows = ['a', 'b', 'c', 'd', 'e'].map(row);
    let i = 0;
    claimNextQueued.mockImplementation(async () => rows[i++] ?? null);
    await enqueue('a');
    await vi.waitFor(() => expect(processMaterial).toHaveBeenCalledTimes(5));
    expect(maxSeen).toBeLessThanOrEqual(2);
  });
});
