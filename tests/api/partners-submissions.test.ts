import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resolvePartner, listSubmissions, findSubmission, createDraft, updateDraft,
        submitDraft, deleteSubmission, logPartnerEvent, bumpLastActive } = vi.hoisted(() => ({
  resolvePartner: vi.fn(),
  listSubmissions: vi.fn(),
  findSubmission: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  submitDraft: vi.fn(),
  deleteSubmission: vi.fn(),
  logPartnerEvent: vi.fn(),
  bumpLastActive: vi.fn(),
}));

vi.mock('@/lib/partners/auth', () => ({ resolvePartner }));

vi.mock('@/lib/partners/submission-queries', () => ({
  listSubmissions, findSubmission, createDraft, updateDraft, submitDraft, deleteSubmission,
}));
vi.mock('@/lib/partners/queries', () => ({ logPartnerEvent, bumpLastActive }));

import { GET as listRoute, POST as createRoute } from '@/app/api/partners/submissions/route';
import { GET as getOne, PATCH as patchOne, DELETE as delOne }
  from '@/app/api/partners/submissions/[submissionId]/route';
import { POST as submitRoute } from '@/app/api/partners/submissions/[submissionId]/submit/route';

beforeEach(() => {
  for (const m of [resolvePartner, listSubmissions, findSubmission, createDraft, updateDraft,
                   submitDraft, deleteSubmission, logPartnerEvent, bumpLastActive]) m.mockReset();
  resolvePartner.mockResolvedValue({ id: 'p1', firstName: 'A', lastName: 'X', email: 'a@x', company: 'X', active: true });
  bumpLastActive.mockResolvedValue(undefined);
  logPartnerEvent.mockResolvedValue(undefined);
});

function jsonReq(method: string, body?: unknown) {
  return new Request('http://test/api/partners/submissions', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/partners/submissions', () => {
  it('returns the partner\'s submissions', async () => {
    listSubmissions.mockResolvedValue([{ id: 's1', positionTitle: 'Press Op', status: 'submitted' }]);
    const res = await listRoute(new Request('http://test/api/partners/submissions'));
    const json = await res.json();
    expect(json.submissions).toHaveLength(1);
  });

  it('401s when unauth', async () => {
    resolvePartner.mockResolvedValue(null);
    const res = await listRoute(new Request('http://test/api/partners/submissions'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/partners/submissions', () => {
  it('creates a draft with at minimum positionTitle', async () => {
    createDraft.mockResolvedValue({ id: 's-new', positionTitle: 'Press Op', status: 'draft' });
    const res = await createRoute(jsonReq('POST', { positionTitle: 'Press Op' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.submission.id).toBe('s-new');
    expect(createDraft).toHaveBeenCalledWith('p1', expect.objectContaining({ positionTitle: 'Press Op' }));
  });

  it('400s when positionTitle missing', async () => {
    const res = await createRoute(jsonReq('POST', { responsibilities: 'no title' }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH submission', () => {
  it('updates a draft', async () => {
    updateDraft.mockResolvedValue({ id: 's1', positionTitle: 'Updated', status: 'draft' });
    const res = await patchOne(jsonReq('PATCH', { positionTitle: 'Updated' }), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(200);
  });

  it('404s when draft not found / already submitted', async () => {
    updateDraft.mockResolvedValue(null);
    const res = await patchOne(jsonReq('PATCH', { positionTitle: 'x' }), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(404);
  });
});

describe('POST :submit', () => {
  it('flips status to submitted + logs event', async () => {
    submitDraft.mockResolvedValue({ id: 's1', positionTitle: 'X', status: 'submitted', careerTargetId: 't1' });
    const res = await submitRoute(jsonReq('POST'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(200);
    expect(logPartnerEvent).toHaveBeenCalledWith('p1', 'submitted_position',
      expect.objectContaining({ submissionId: 's1', careerTargetId: 't1' }));
  });

  it('409 if already submitted (submitDraft returns null)', async () => {
    submitDraft.mockResolvedValue(null);
    const res = await submitRoute(jsonReq('POST'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(409);
  });
});

describe('DELETE submission', () => {
  it('204 when deleted', async () => {
    deleteSubmission.mockResolvedValue(true);
    const res = await delOne(jsonReq('DELETE'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(204);
  });

  it('404 when not found', async () => {
    deleteSubmission.mockResolvedValue(false);
    const res = await delOne(jsonReq('DELETE'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(404);
  });
});

describe('GET one submission', () => {
  it('returns the row', async () => {
    findSubmission.mockResolvedValue({ id: 's1', positionTitle: 'X', status: 'draft' });
    const res = await getOne(jsonReq('GET'), { params: Promise.resolve({ submissionId: 's1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.submission.id).toBe('s1');
  });
  it('404 when not owned', async () => {
    findSubmission.mockResolvedValue(null);
    const res = await getOne(jsonReq('GET'), { params: Promise.resolve({ submissionId: 'x' }) });
    expect(res.status).toBe(404);
  });
});
