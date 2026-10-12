// P0b Task 5: coverage scoring moved from per-target to per-competency, so
// this route no longer builds (snapshot, target) pairs — it scores one
// stale SNAPSHOT at a time, carrying only that snapshot's missing
// competency ids (listStaleSnapshots), ordered by courseCode for
// determinism. Dropping cells for ids outside the input is now the
// scorer's own job (see lib/ai/analyze/__tests__/program-score-coverage.test.ts),
// not this route's.
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: vi.fn().mockReturnValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('hash') }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({
  checkDailyCap: vi.fn().mockResolvedValue({ ok: true }),
  recordSpend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({
  getSnapshotById: vi.fn((id: string) => Promise.resolve({ id, courseCode: id === 'snap-a' ? 'GC 1010' : 'GC 2020', profile: {} })),
}));
vi.mock('@/lib/ai/wiki/update', () => ({ regenerateWikiInBackground: vi.fn() }));

const upsertCoverageCell = vi.fn().mockResolvedValue(undefined);
const listStaleSnapshots = vi.fn();
vi.mock('@/lib/db/program-coverage-queries', () => ({ upsertCoverageCell, listStaleSnapshots }));

const scoreSnapshotCompetencies = vi.fn();
vi.mock('@/lib/ai/analyze/program-score-coverage', () => ({ scoreSnapshotCompetencies }));

const CATALOG = [
  { id: 'comp-1', name: 'C1', knowDescriptor: 'k1', understandDescriptor: 'u1', doDescriptor: 'd1', retired: false },
  { id: 'comp-2', name: 'C2', knowDescriptor: 'k2', understandDescriptor: 'u2', doDescriptor: 'd2', retired: false },
  { id: 'comp-3', name: 'C3', knowDescriptor: 'k3', understandDescriptor: 'u3', doDescriptor: 'd3', retired: false },
];

const dbSelect = vi.fn();
vi.mock('@/lib/db/client', () => ({ db: { select: dbSelect } }));

function makeReq() {
  return new Request('http://x/api/program/coverage/refresh?slug=valid-slug', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelect.mockImplementation(() => ({ from: () => Promise.resolve(CATALOG) }));
  scoreSnapshotCompetencies.mockResolvedValue({
    result: { cells: [] },
    model: 'test-model',
    costUsdCents: 1,
  });
});

describe('POST /api/program/coverage/refresh', () => {
  it('calls the scorer once per stale snapshot, carrying only that snapshot\'s missing competency ids, ordered by courseCode', async () => {
    listStaleSnapshots.mockResolvedValue([
      { snapshotId: 'snap-b', courseCode: 'GC 2020', missingCompetencyIds: ['comp-3'] },
      { snapshotId: 'snap-a', courseCode: 'GC 1010', missingCompetencyIds: ['comp-1', 'comp-2'] },
    ]);

    const { POST } = await import('@/app/api/program/coverage/refresh/route');
    const res = await POST(makeReq());
    const body = await res.json();

    expect(scoreSnapshotCompetencies).toHaveBeenCalledTimes(2);
    // Ordered by courseCode: GC 1010 (snap-a) before GC 2020 (snap-b).
    const calls = scoreSnapshotCompetencies.mock.calls.map(c => c[0]);
    expect(calls[0].snapshotId).toBe('snap-a');
    expect(calls[0].competencies.map((c: { id: string }) => c.id)).toEqual(['comp-1', 'comp-2']);
    expect(calls[1].snapshotId).toBe('snap-b');
    expect(calls[1].competencies.map((c: { id: string }) => c.id)).toEqual(['comp-3']);
    expect(body.scored).toBe(2);
    expect(body.failed).toBe(0);
  });

  it('upserts every cell the scorer returns, keyed by competency_id', async () => {
    listStaleSnapshots.mockResolvedValue([
      { snapshotId: 'snap-a', courseCode: 'GC 1010', missingCompetencyIds: ['comp-1'] },
    ]);
    scoreSnapshotCompetencies.mockResolvedValue({
      result: {
        cells: [
          { competency_id: 'comp-1', k_depth: 2, u_depth: 2, d_depth: 2, matched_competency: null, evidence_excerpt: null, confidence: 'high', rationale: 'r' },
        ],
      },
      model: 'test-model',
      costUsdCents: 1,
    });

    const { POST } = await import('@/app/api/program/coverage/refresh/route');
    await POST(makeReq());

    expect(upsertCoverageCell).toHaveBeenCalledTimes(1);
    expect(upsertCoverageCell).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap-a', subCompetencyId: 'comp-1' }));
  });
});
