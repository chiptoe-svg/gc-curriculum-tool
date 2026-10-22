// @vitest-environment node
// P2 Task 11 — the eight /api/admin/bundles routes with the query layer
// mocked: second factor (401), JSON content type (415), id / reviewer /
// action validation (400), Cache-Control: no-store, and pass-through of the
// query functions' { ok: false, status }.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const q = {
  listBundlesForReview: vi.fn(), readBundleDetail: vi.fn(), submitBlindPicks: vi.fn(), applyMemberAction: vi.fn(),
  bulkConfirm: vi.fn(), resetBlind: vi.fn(), searchItems: vi.fn(), readAgreementInputs: vi.fn(),
};

vi.mock('@/lib/auth/admin-auth', () => ({ checkAdminAuth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/db/client', () => ({ db: { transaction: (fn: (tx: unknown) => unknown) => fn('TX') } }));
vi.mock('@/lib/db/bundle-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/bundle-queries')>('@/lib/db/bundle-queries');
  return {
    ONET_ATTRIBUTION: actual.ONET_ATTRIBUTION, validateReviewer: actual.validateReviewer,
    listBundlesForReview: (...a: unknown[]) => q.listBundlesForReview(...a),
    readBundleDetail: (...a: unknown[]) => q.readBundleDetail(...a),
    submitBlindPicks: (...a: unknown[]) => q.submitBlindPicks(...a),
    applyMemberAction: (...a: unknown[]) => q.applyMemberAction(...a),
    bulkConfirm: (...a: unknown[]) => q.bulkConfirm(...a),
    resetBlind: (...a: unknown[]) => q.resetBlind(...a),
    searchItems: (...a: unknown[]) => q.searchItems(...a),
    readAgreementInputs: (...a: unknown[]) => q.readAgreementInputs(...a),
  };
});

const mockRecompute = vi.fn(async (_reason: string) => {});
vi.mock('@/lib/db/career-weight-queries', () => ({ recomputeCareerWeightsSafely: (r: string) => mockRecompute(r) }));

import { GET as listGET } from '../route';
import { GET as detailGET } from '../[id]/route';
import { GET as agreementGET } from '../agreement/route';
import { GET as searchGET } from '../search/route';
import { POST as membersPOST } from '../[id]/members/route';
import { POST as bulkPOST } from '../[id]/bulk-confirm/route';
import { POST as resetPOST } from '../[id]/reset-blind/route';
import { POST as blindPOST } from '../[id]/blind/route';

const UUID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const KEY = '0123456789abcdef';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string) => new Request(`http://h${path}`);
const post = (path: string, body: unknown, ct = 'application/json') =>
  new Request(`http://h${path}`, { method: 'POST', headers: { 'content-type': ct }, body: JSON.stringify(body) });

type PostHandler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const POSTS: Array<{ name: string; handler: PostHandler; path: string; good: Record<string, unknown>; fn: keyof typeof q }> = [
  { name: 'members', handler: membersPOST, path: 'members', good: { reviewer: 'R', action: 'confirm', memberIds: [UUID] }, fn: 'applyMemberAction' },
  { name: 'bulk-confirm', handler: bulkPOST, path: 'bulk-confirm', good: { reviewer: 'R' }, fn: 'bulkConfirm' },
  { name: 'reset-blind', handler: resetPOST, path: 'reset-blind', good: { reviewer: 'R', note: 'redo' }, fn: 'resetBlind' },
  { name: 'blind', handler: blindPOST, path: 'blind', good: { reviewer: 'R', noCleanMatch: false, picks: [{ kind: 'element', elementId: '2.B.5.a', position: 'core' }] }, fn: 'submitBlindPicks' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockReturnValue(true);
  q.listBundlesForReview.mockResolvedValue([
    { id: 'a', name: 'A', stratum: 'technical', sampled: false, submitted: false, counts: { proposed: 0, confirmed: 2, rejected: 0 }, noCleanMatch: false, mapped: true },
    { id: 'b', name: 'B', stratum: null, sampled: true, submitted: false, counts: null, noCleanMatch: null, mapped: true },
    { id: 'c', name: 'C', stratum: null, sampled: false, submitted: false, counts: { proposed: 3, confirmed: 0, rejected: 0 }, noCleanMatch: false, mapped: true },
  ]);
  q.readBundleDetail.mockResolvedValue({ bundle: { id: 'a' }, members: null });
  q.searchItems.mockResolvedValue({ elements: [], tasks: [] });
  q.readAgreementInputs.mockResolvedValue({ inputs: [], noMatch: [], notYetMapped: [], secondReviewerPairs: [] });
  for (const p of POSTS) q[p.fn].mockResolvedValue({ ok: true, changed: 1 });
});

describe('GET routes', () => {
  const GETS: Array<[string, () => Promise<Response>, keyof typeof q]> = [
    ['list', () => listGET(get('/api/admin/bundles')), 'listBundlesForReview'],
    ['detail', () => detailGET(get('/api/admin/bundles/a'), params('a')), 'readBundleDetail'],
    ['agreement', () => agreementGET(get('/api/admin/bundles/agreement')), 'readAgreementInputs'],
    ['search', () => searchGET(get('/api/admin/bundles/search?q=press')), 'searchItems'],
  ];

  it.each(GETS)('%s: 401 when the second factor fails, before any query', async (_n, call, fn) => {
    mockAuth.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(q[fn]).not.toHaveBeenCalled();
  });

  it.each(GETS)('%s: 200 with no-store and the O*NET attribution', async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await res.json()) as { attribution: string }).attribution).toMatch(/^This product includes information from O\*NET 31\.0 Database/);
  });

  it('list: progress counts reviewed bundles (0 proposed, mapped, not locked)', async () => {
    const json = (await (await listGET(get('/api/admin/bundles'))).json()) as { progress: unknown };
    expect(json.progress).toEqual({ reviewed: 1, total: 3 });
  });

  it('detail: 400 on a bad id, 404 when missing', async () => {
    for (const bad of ['UPPER', 'a_b', 'x'.repeat(81), '../etc']) {
      const res = await detailGET(get('/api/admin/bundles/x'), params(bad));
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(q.readBundleDetail).not.toHaveBeenCalled();
    q.readBundleDetail.mockResolvedValue(null);
    expect((await detailGET(get('/api/admin/bundles/zz'), params('zz'))).status).toBe(404);
  });

  it('search: 400 for a missing, too short or too long q', async () => {
    for (const s of ['', '?q=a', `?q=${'x'.repeat(101)}`]) {
      expect((await searchGET(get(`/api/admin/bundles/search${s}`))).status).toBe(400);
    }
    expect(q.searchItems).not.toHaveBeenCalled();
  });

  it('agreement: computes rows, total and kappas from the inputs', async () => {
    q.readAgreementInputs.mockResolvedValue({
      inputs: [{ bundleId: 'a', ai: new Map([['element:1', 'core']]), blind: new Map([['element:1', 'core']]) }],
      noMatch: [], notYetMapped: ['b'], secondReviewerPairs: [{ bundleId: 'a', a: ['core', 'none'], b: ['core', 'related'] }],
    });
    const json = (await (await agreementGET(get('/api/admin/bundles/agreement'))).json()) as { rows: Array<{ exact: number }>; total: { bundleId: string }; kappas: unknown[]; notYetMapped: string[] };
    expect(json.rows[0]!.exact).toBe(1);
    expect(json.total.bundleId).toBe('ALL');
    expect(json.kappas).toHaveLength(1);
    expect(json.notYetMapped).toEqual(['b']);
  });
});

describe.each(POSTS)('POST $name', ({ handler, path, good, fn }) => {
  const url = `/api/admin/bundles/a/${path}`;

  it('415 without a JSON content type, before auth', async () => {
    const res = await handler(post(url, good, 'text/plain'), params('a'));
    expect(res.status).toBe(415);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mockAuth).not.toHaveBeenCalled();
    expect(q[fn]).not.toHaveBeenCalled();
  });

  it('401 when the second factor fails; the body slug is passed to it', async () => {
    mockAuth.mockReturnValue(false);
    const res = await handler(post(url, { ...good, slug: 'the-slug' }), params('a'));
    expect(res.status).toBe(401);
    expect(mockAuth.mock.calls[0]![1]).toEqual({ slug: 'the-slug' });
    expect(q[fn]).not.toHaveBeenCalled();
  });

  it('400 on a bad id', async () => {
    const res = await handler(post(url, good), params('Bad_Id'));
    expect(res.status).toBe(400);
    expect(q[fn]).not.toHaveBeenCalled();
  });

  it('400 on a missing, blank or oversized reviewer', async () => {
    for (const reviewer of [undefined, '   ', 'x'.repeat(81), 7]) {
      const res = await handler(post(url, { ...good, reviewer }), params('a'));
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(q[fn]).not.toHaveBeenCalled();
  });

  it('200 with no-store; the reviewer is trimmed and the call runs in the transaction', async () => {
    const res = await handler(post(url, { ...good, reviewer: '  Pat  ' }), params('a'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(q[fn]).toHaveBeenCalledTimes(1);
    const args = q[fn].mock.calls[0]!;
    expect(args[0]).toBe('TX');
    expect(args[1]).toBe('a');
    expect(args[2]).toBe('Pat');
  });

  it.each([400, 404, 409])('passes the query function\'s { ok: false, status: %i } through', async (status) => {
    q[fn].mockResolvedValue({ ok: false, status, error: `e${status}` });
    const res = await handler(post(url, good), params('a'));
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: `e${status}` });
  });
});

describe('POST action shapes', () => {
  const bad = async (handler: PostHandler, path: string, body: Record<string, unknown>) =>
    (await handler(post(`/api/admin/bundles/a/${path}`, { reviewer: 'R', ...body }), params('a'))).status;

  it('members: 400 for each malformed action', async () => {
    for (const body of [
      {}, { action: 'delete', memberIds: [UUID] }, { action: 'confirm', memberIds: [] }, { action: 'confirm', memberIds: ['x'] },
      // structural UUID check (ruling A): 36 chars of hex and dashes in the wrong places
      { action: 'confirm', memberIds: ['------------------------------------'] },
      { action: 'confirm', memberIds: Array.from({ length: 501 }, () => UUID) },
      { action: 'set_position', memberIds: [UUID], position: 'central' }, { action: 'set_position', memberIds: [UUID] },
      { action: 'add', position: 'core' }, { action: 'add', item: { kind: 'element', elementId: '2.B.5.a' } },
      { action: 'add', item: { kind: 'element', elementId: 'x y' }, position: 'core' },
      { action: 'add', item: { kind: 'task', taskId: '1' }, position: 'core' },
      { action: 'add', item: { kind: 'task', taskId: '1', onetSocCode: 'bad' }, position: 'core' },
    ]) expect(await bad(membersPOST, 'members', body)).toBe(400);
    expect(q.applyMemberAction).not.toHaveBeenCalled();
  });

  it('members: well-formed actions reach applyMemberAction with release 31.0', async () => {
    for (const body of [
      { action: 'reject', memberIds: [UUID.toUpperCase()] },
      { action: 'set_position', memberIds: [UUID], position: 'fringe' },
      { action: 'add', item: { kind: 'element', elementId: '2.B.5.a' }, position: 'related' },
      { action: 'add', item: { kind: 'task', taskId: '123', onetSocCode: '11-2022.00' }, position: 'core' },
    ]) expect(await bad(membersPOST, 'members', body)).toBe(200);
    expect(q.applyMemberAction.mock.calls.map(c => c[4])).toEqual(['31.0', '31.0', '31.0', '31.0']);
    expect(q.applyMemberAction.mock.calls[3]![3]).toEqual({ action: 'add', item: { kind: 'task', taskId: '123', onetSocCode: '11-2022.00' }, position: 'core' });
  });

  it('blind: 400 for malformed picks or a missing noCleanMatch', async () => {
    for (const body of [
      { noCleanMatch: false }, { picks: [], noCleanMatch: 'no' }, { picks: 'x', noCleanMatch: false },
      { picks: [{ kind: 'element', elementId: '2.B.5.a', position: 'top' }], noCleanMatch: false },
      { picks: [{ kind: 'task', groupKey: 'nothex', position: 'core' }], noCleanMatch: false },
      { picks: [{ kind: 'other', position: 'core' }], noCleanMatch: false },
      { picks: [null], noCleanMatch: false },
      // The blind check offers core / related / unmarked only (decision 2026-10-19).
      { picks: [{ kind: 'element', elementId: '2.B.5.a', position: 'fringe' }], noCleanMatch: false },
      { picks: [{ kind: 'task', groupKey: KEY, position: 'fringe' }], noCleanMatch: false },
    ]) expect(await bad(blindPOST, 'blind', body)).toBe(400);
    expect(q.submitBlindPicks).not.toHaveBeenCalled();
    expect(await bad(blindPOST, 'blind', { picks: [{ kind: 'task', groupKey: KEY, position: 'core' }], noCleanMatch: false })).toBe(200);
    expect(q.submitBlindPicks.mock.calls[0]!.slice(3)).toEqual([[{ kind: 'task', groupKey: KEY, position: 'core' }], false, '31.0']);
  });

  it('reset-blind: 400 for a missing, blank or oversized note', async () => {
    for (const note of [undefined, '  ', 'x'.repeat(501), 3]) expect(await bad(resetPOST, 'reset-blind', { note })).toBe(400);
    expect(q.resetBlind).not.toHaveBeenCalled();
  });
});

describe('career-weight recompute after review writes', () => {
  it('runs after a successful member action, not after a refused one', async () => {
    const res = await membersPOST(post('/api/admin/bundles/a/members', { reviewer: 'R', action: 'confirm', memberIds: [UUID] }), params('a'));
    expect(res.status).toBe(200);
    expect(mockRecompute).toHaveBeenCalledWith('bundle review');
    q.applyMemberAction.mockResolvedValueOnce({ ok: false, status: 409, error: 'blind sample not submitted' });
    const refused = await membersPOST(post('/api/admin/bundles/a/members', { reviewer: 'R', action: 'confirm', memberIds: [UUID] }), params('a'));
    expect(refused.status).toBe(409);
    expect(mockRecompute).toHaveBeenCalledTimes(1);
  });

  it('runs after a successful bulk confirm', async () => {
    const res = await bulkPOST(post('/api/admin/bundles/a/bulk-confirm', { reviewer: 'R' }), params('a'));
    expect(res.status).toBe(200);
    expect(mockRecompute).toHaveBeenCalledWith('bundle review');
  });

  it('runs after a successful blind submit, not after a refused one', async () => {
    q.submitBlindPicks.mockResolvedValueOnce({ ok: true });
    const ok = await blindPOST(post('/api/admin/bundles/a/blind', { reviewer: 'R', picks: [], noCleanMatch: false }), params('a'));
    expect(ok.status).toBe(200);
    expect(mockRecompute).toHaveBeenCalledWith('blind submit');
    q.submitBlindPicks.mockResolvedValueOnce({ ok: false, status: 409, error: 'already submitted' });
    await blindPOST(post('/api/admin/bundles/a/blind', { reviewer: 'R', picks: [], noCleanMatch: false }), params('a'));
    expect(mockRecompute).toHaveBeenCalledTimes(1);
  });

  it('runs after a successful blind reset', async () => {
    q.resetBlind.mockResolvedValueOnce({ ok: true });
    const ok = await resetPOST(post('/api/admin/bundles/a/reset-blind', { reviewer: 'R', note: 'redo' }), params('a'));
    expect(ok.status).toBe(200);
    expect(mockRecompute).toHaveBeenCalledWith('blind reset');
  });
});
