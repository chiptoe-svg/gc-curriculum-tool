import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the factory below can reference the mock fn without tripping
// vitest's "cannot access before initialization" hoist guard (the repo's
// existing worker test uses this same pattern).
const { updateIndexingStatus } = vi.hoisted(() => ({ updateIndexingStatus: vi.fn(async () => {}) }));
vi.mock('@/lib/db/course-materials-queries', () => ({
  updateIndexingStatus,
  claimNextQueued: async () => null,
  resetStuckIndexing: async () => 0,
}));

import { enqueue } from '../ingest-queue';

describe('enqueue stamps ingest_provider', () => {
  beforeEach(() => updateIndexingStatus.mockClear());

  it("passes ingestProvider:'local' when given", async () => {
    await enqueue('m1', { ingestProvider: 'local' });
    expect(updateIndexingStatus).toHaveBeenCalledWith({ id: 'm1', status: 'queued', ingestProvider: 'local' });
  });

  it('passes ingestProvider:null for hybrid', async () => {
    await enqueue('m2', { ingestProvider: null });
    expect(updateIndexingStatus).toHaveBeenCalledWith({ id: 'm2', status: 'queued', ingestProvider: null });
  });
});
