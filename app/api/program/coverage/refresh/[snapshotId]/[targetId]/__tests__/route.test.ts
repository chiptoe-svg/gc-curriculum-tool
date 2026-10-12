// P0b Task 5: the scoring call now carries no career-target context — the
// route reads this target's ACTIVE (non-retired) members from
// target_sub_competencies and scores exactly those, via
// scoreSnapshotCompetencies. Dropping off-target cells is now the scorer's
// own job (unknown ids are dropped before it returns), so this route no
// longer needs its own member-id filter.
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
  getSnapshotById: vi.fn().mockResolvedValue({ courseCode: 'GC 1010', profile: {} }),
}));
vi.mock('@/lib/ai/wiki/update', () => ({ regenerateWikiInBackground: vi.fn() }));

const upsertCoverageCell = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/db/program-coverage-queries', () => ({ upsertCoverageCell }));

const scoreSnapshotCompetencies = vi.fn();
vi.mock('@/lib/ai/analyze/program-score-coverage', () => ({ scoreSnapshotCompetencies }));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.where = () => c;
  c.orderBy = () => c;
  c.limit = (n: number) => Promise.resolve(rows.slice(0, n));
  c.then = (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
  return c;
}

const dbSelect = vi.fn();
vi.mock('@/lib/db/client', () => ({ db: { select: dbSelect } }));

const TARGET_ROW = {
  id: 't1', name: 'Target One', shortDefinition: 'sd',
  knowDescriptors: [], understandDescriptors: [], doDescriptors: [],
};
const MEMBER_SUBS = [
  { id: 'member-1', name: 'M1', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd', displayOrder: 0, retired: false },
  { id: 'retired-1', name: 'R1', knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd', displayOrder: 1, retired: true },
];

function makeReq() {
  return [
    new Request('http://x/api/program/coverage/refresh/snap-1/t1?slug=valid-slug', { method: 'POST' }),
    { params: Promise.resolve({ snapshotId: 'snap-1', targetId: 't1' }) },
  ] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Call order in the route: careerTargets (.limit(1)), then targetSubCompetencies.
  dbSelect.mockImplementation(() => {
    const callIndex = dbSelect.mock.calls.length;
    return { from: () => (callIndex === 1 ? chain([TARGET_ROW]) : chain(MEMBER_SUBS)) };
  });
  scoreSnapshotCompetencies.mockResolvedValue({
    result: { cells: [] },
    model: 'test-model',
    costUsdCents: 1,
  });
});

describe('POST /api/program/coverage/refresh/[snapshotId]/[targetId]', () => {
  it('scores exactly the target\'s ACTIVE (non-retired) members, with no career-target context', async () => {
    const { POST } = await import('@/app/api/program/coverage/refresh/[snapshotId]/[targetId]/route');
    const [req, ctx] = makeReq();
    await POST(req, ctx);

    expect(scoreSnapshotCompetencies).toHaveBeenCalledTimes(1);
    const call = scoreSnapshotCompetencies.mock.calls[0]![0];
    expect(call.competencies.map((c: { id: string }) => c.id)).toEqual(['member-1']);
    expect(call).not.toHaveProperty('careerTarget');
  });

  it('upserts every cell the scorer returns, keyed by competency_id', async () => {
    scoreSnapshotCompetencies.mockResolvedValue({
      result: {
        cells: [
          { competency_id: 'member-1', k_depth: 2, u_depth: 2, d_depth: 2, matched_competency: null, evidence_excerpt: null, confidence: 'high', rationale: 'r' },
        ],
      },
      model: 'test-model',
      costUsdCents: 1,
    });

    const { POST } = await import('@/app/api/program/coverage/refresh/[snapshotId]/[targetId]/route');
    const [req, ctx] = makeReq();
    const res = await POST(req, ctx);
    const body = await res.json();

    expect(upsertCoverageCell).toHaveBeenCalledTimes(1);
    expect(upsertCoverageCell).toHaveBeenCalledWith(expect.objectContaining({ subCompetencyId: 'member-1' }));
    expect(body.cellCount).toBe(1);
  });
});
