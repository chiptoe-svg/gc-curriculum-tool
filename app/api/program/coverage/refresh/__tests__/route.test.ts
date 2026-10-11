// Ruling 10 (P0a plan): cells are stored per (snapshot, competency) since
// migration 0056, so a cell the scorer returns for a sub-competency outside
// the scored target would overwrite another target's cell if written. This
// route must drop any cell whose sub_competency_id is not a member of the
// target (per target_sub_competencies), writing only member cells.
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
const listStalePairs = vi.fn();
vi.mock('@/lib/db/program-coverage-queries', () => ({ upsertCoverageCell, listStalePairs }));

const scoreSnapshotAgainstTarget = vi.fn();
vi.mock('@/lib/ai/analyze/program-score-coverage', () => ({ scoreSnapshotAgainstTarget }));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.where = () => c;
  c.orderBy = () => c; // M-3: route now orders the subs read
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
];

function makeReq() {
  return new Request('http://x/api/program/coverage/refresh?slug=valid-slug', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Pre-fetch loop in the route: per unique target, careerTargets (.limit(1))
  // then targetSubCompetencies — odd calls are careerTargets, even are subs.
  dbSelect.mockImplementation(() => {
    const callIndex = dbSelect.mock.calls.length;
    return { from: () => (callIndex % 2 === 1 ? chain([TARGET_ROW]) : chain(MEMBER_SUBS)) };
  });
  listStalePairs.mockResolvedValue([
    { snapshotId: 'snap-1', courseCode: 'GC 1010', careerTargetId: 't1', careerTargetName: 'Target One' },
  ]);
});

describe('POST /api/program/coverage/refresh — Ruling 10 off-target filter', () => {
  it('drops a scored cell whose sub_competency_id is not a member of the target', async () => {
    scoreSnapshotAgainstTarget.mockResolvedValue({
      result: {
        cells: [
          { sub_competency_id: 'member-1', k_depth: 2, u_depth: 2, d_depth: 2, matched_competency: null, evidence_excerpt: null, confidence: 'high', rationale: 'r' },
          { sub_competency_id: 'off-target', k_depth: 1, u_depth: 1, d_depth: 1, matched_competency: null, evidence_excerpt: null, confidence: 'high', rationale: 'r' },
        ],
      },
      model: 'test-model',
      costUsdCents: 1,
    });

    const { POST } = await import('@/app/api/program/coverage/refresh/route');
    const res = await POST(makeReq());
    const body = await res.json();

    expect(upsertCoverageCell).toHaveBeenCalledTimes(1);
    expect(upsertCoverageCell).toHaveBeenCalledWith(expect.objectContaining({ subCompetencyId: 'member-1' }));
    expect(body.scored).toBe(1);
    expect(body.failed).toBe(0);
  });

  it('writes every cell when all are members (no false drops)', async () => {
    scoreSnapshotAgainstTarget.mockResolvedValue({
      result: {
        cells: [
          { sub_competency_id: 'member-1', k_depth: 2, u_depth: 2, d_depth: 2, matched_competency: null, evidence_excerpt: null, confidence: 'high', rationale: 'r' },
        ],
      },
      model: 'test-model',
      costUsdCents: 1,
    });

    const { POST } = await import('@/app/api/program/coverage/refresh/route');
    await POST(makeReq());

    expect(upsertCoverageCell).toHaveBeenCalledTimes(1);
    expect(upsertCoverageCell).toHaveBeenCalledWith(expect.objectContaining({ subCompetencyId: 'member-1' }));
  });
});
