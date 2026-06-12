import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'good' }));
vi.mock('@/lib/db/flag-queries', () => ({
  createFlag: vi.fn(async (input: Record<string, unknown>) => ({ id: 'new-id', status: 'open', ...input })),
  listFlags: vi.fn(async () => [
    {
      id: 'f1', targetKind: 'coverage_cell', courseCode: 'GC 1010',
      careerTargetId: 't1', subCompetencyId: 's1', competencyStatement: null,
      note: 'n', flaggedBy: 'Erica Walker', flaggedContext: { k: 1, u: 1, d: 4 },
      status: 'open', resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: new Date(),
    },
  ]),
  resolveFlag: vi.fn(async (id: string) => {
    if (id === 'gone') throw new Error('flag already resolved: gone');
    return { id, status: 'resolved' };
  }),
}));
vi.mock('@/lib/db/program-coverage-queries', () => ({
  getMatrixData: vi.fn(async () => ({
    courses: [{ courseCode: 'GC 1010', courseTitle: 'T', level: 1000, snapshotId: 'snap1', snapshotCaption: null, snapshotCreatedAt: new Date() }],
    targets: [], subCompetencies: [],
    cells: [{ snapshotId: 'snap1', careerTargetId: 't1', subCompetencyId: 's1', kDepth: 1, uDepth: 1, dDepth: 2, matchedCompetency: null, evidenceExcerpt: null, confidence: 'high', rationale: '' }],
  })),
}));

import { POST, GET } from '@/app/api/flags/route';
import { PATCH } from '@/app/api/flags/[id]/route';

beforeEach(() => { vi.clearAllMocks(); });

const goodCreate = {
  targetKind: 'coverage_cell', courseCode: 'GC 1010', careerTargetId: 't1',
  subCompetencyId: 's1', competencyStatement: null,
  note: 'depth looks too high', flaggedBy: 'Erica Walker',
  flaggedContext: { k: 1, u: 1, d: 4 },
};

describe('POST /api/flags', () => {
  it('401s on bad slug', async () => {
    const res = await POST(new Request('http://x/api/flags?slug=bad', { method: 'POST', body: JSON.stringify(goodCreate) }));
    expect(res.status).toBe(401);
  });
  it('creates a valid cell flag', async () => {
    const res = await POST(new Request('http://x/api/flags?slug=good', { method: 'POST', body: JSON.stringify(goodCreate) }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.flag.id).toBe('new-id');
  });
  it('400s on kind/field inconsistency (cell flag with a statement)', async () => {
    const res = await POST(new Request('http://x/api/flags?slug=good', {
      method: 'POST',
      body: JSON.stringify({ ...goodCreate, competencyStatement: 'should not be here' }),
    }));
    expect(res.status).toBe(400);
  });
  it('400s on empty note', async () => {
    const res = await POST(new Request('http://x/api/flags?slug=good', { method: 'POST', body: JSON.stringify({ ...goodCreate, note: '  ' }) }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/flags', () => {
  it('annotates open cell flags with drift and stillInMatrix', async () => {
    const res = await GET(new Request('http://x/api/flags?slug=good&status=open'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.flags).toHaveLength(1);
    expect(json.flags[0].stillInMatrix).toBe(true);
    expect(json.flags[0].drift).toEqual([{ dim: 'd', was: 4, now: 2 }]);
  });
});

describe('PATCH /api/flags/[id]', () => {
  it('resolves with name + note', async () => {
    const res = await PATCH(
      new Request('http://x/api/flags/f1?slug=good', { method: 'PATCH', body: JSON.stringify({ resolvedBy: 'Chip Tonkin', resolutionNote: 'agreed after re-score' }) }),
      { params: Promise.resolve({ id: 'f1' }) },
    );
    expect(res.status).toBe(200);
  });
  it('400s on missing resolution note', async () => {
    const res = await PATCH(
      new Request('http://x/api/flags/f1?slug=good', { method: 'PATCH', body: JSON.stringify({ resolvedBy: 'Chip Tonkin', resolutionNote: '' }) }),
      { params: Promise.resolve({ id: 'f1' }) },
    );
    expect(res.status).toBe(400);
  });
  it('409s on already-resolved', async () => {
    const res = await PATCH(
      new Request('http://x/api/flags/gone?slug=good', { method: 'PATCH', body: JSON.stringify({ resolvedBy: 'Chip Tonkin', resolutionNote: 'x' }) }),
      { params: Promise.resolve({ id: 'gone' }) },
    );
    expect(res.status).toBe(409);
  });
});
