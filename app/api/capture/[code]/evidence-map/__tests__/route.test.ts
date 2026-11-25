import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(), rate: vi.fn(), cap: vi.fn(), runPreRead: vi.fn(), createSession: vi.fn(), getSession: vi.fn(),
  saveMap: vi.fn(), claim: vi.fn(), markReady: vi.fn(), saveEdited: vi.fn(), messages: vi.fn(), materials: vi.fn(),
}));
vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: h.auth }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: h.rate }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: h.cap }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 3460' }) }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ startNewSession: () => 'sess-1', getSessionMessages: h.messages }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: h.materials }));
vi.mock('@/lib/db/capture-interview-sessions-queries', () => ({
  createInterviewSession: h.createSession, getInterviewSession: h.getSession, saveEvidenceMap: h.saveMap, claimPreRead: h.claim, markEditedReady: h.markReady, saveEditedEvidenceMap: h.saveEdited,
}));
vi.mock('@/lib/capture/staged/pre-read', async (orig) => ({ ...(await orig<typeof import('@/lib/capture/staged/pre-read')>()), runPreRead: h.runPreRead }));

import { POST, GET, PUT } from '../route';
import { materialsFingerprint } from '@/lib/capture/staged/pre-read';

const ctx = { params: Promise.resolve({ code: 'GC%203460' }) };
const url = (q = '') => `http://x/api/capture/GC%203460/evidence-map?slug=s${q}`;
const json = (method: string, body: unknown, q = '') => new Request(url(q), { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const MAP = { summary: 's', graded_work: [], tests: [], competencies: [], assumed_skills: [], objectives: [], conflicts: [], unreadable: [] };
const mat = (id: string) => ({ id, fileName: `${id}.pdf`, digest: 'd', extractionStatus: 'ok', ignored: false, autoSetAside: false, retiredAt: null, ignoredItems: [], uploadedAt: new Date('2026-11-01T00:00:00Z') });
const row = (over: Record<string, unknown> = {}) => ({ mapStartedAt: new Date(), sessionId: 'sess-1', courseCode: 'GC 3460', map: MAP, mapStatus: 'ready', materialsFingerprint: 'old', mapEditedAt: null, createdAt: new Date(), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue(true);
  h.rate.mockResolvedValue({ allowed: true });
  h.cap.mockResolvedValue({ ok: true });
  h.messages.mockResolvedValue([]);
  h.materials.mockResolvedValue([mat('a')]);
  h.claim.mockResolvedValue(true);
});

describe('POST', () => {
  it('creates the session, runs the pre-read, saves and returns it', async () => {
    h.runPreRead.mockResolvedValue({ map: MAP, status: 'ready', fingerprint: 'fp' });
    const res = await POST(json('POST', {}), ctx);
    expect(await res.json()).toEqual({ sessionId: 'sess-1', map: MAP, status: 'ready' });
    expect(h.createSession).toHaveBeenCalledWith({ sessionId: 'sess-1', courseCode: 'GC 3460' });
    expect(h.saveMap).toHaveBeenCalledWith('sess-1', { map: MAP, status: 'ready', fingerprint: 'fp' });
  });

  it('still returns a session id when the pre-read fails', async () => {
    h.runPreRead.mockResolvedValue({ map: null, status: 'failed', fingerprint: 'fp' });
    const res = await POST(json('POST', {}), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: 'sess-1', map: null, status: 'failed' });
    expect(h.createSession).toHaveBeenCalled();
    expect(h.saveMap).toHaveBeenCalledWith('sess-1', { map: null, status: 'failed', fingerprint: 'fp' });
  });

  it('401 when unauthorized, 429 over the rate limit, 503 over the daily cap; none create a session', async () => {
    h.auth.mockResolvedValueOnce(false);
    expect((await POST(json('POST', {}), ctx)).status).toBe(401);
    h.rate.mockResolvedValueOnce({ allowed: false });
    expect((await POST(json('POST', {}), ctx)).status).toBe(429);
    h.cap.mockResolvedValueOnce({ ok: false });
    expect((await POST(json('POST', {}), ctx)).status).toBe(503);
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.runPreRead).not.toHaveBeenCalled();
  });
});

describe('PUT', () => {
  it('saves a valid edited map', async () => {
    h.getSession.mockResolvedValue(row());
    const res = await PUT(json('PUT', { sessionId: 'sess-1', map: MAP }), ctx);
    expect(res.status).toBe(200);
    expect(h.saveEdited).toHaveBeenCalledWith('sess-1', MAP);
  });
  it('final-fix 5: 400 on a map with more than 12 assumed skills', async () => {
    h.getSession.mockResolvedValue(row());
    const skills = Array.from({ length: 13 }, (_, i) => ({ skill: `S${i}`, used_in: 'u', source: 's' }));
    const res = await PUT(json('PUT', { sessionId: 'sess-1', map: { ...MAP, assumed_skills: skills } }), ctx);
    expect(res.status).toBe(400);
    expect(h.saveEdited).not.toHaveBeenCalled();
  });
  it('400 on a bad map', async () => {
    const res = await PUT(json('PUT', { sessionId: 'sess-1', map: { summary: 1 } }), ctx);
    expect(res.status).toBe(400);
    expect(h.saveEdited).not.toHaveBeenCalled();
  });
  it('404 for an unknown session and for another course\'s session', async () => {
    h.getSession.mockResolvedValueOnce(null);
    expect((await PUT(json('PUT', { sessionId: 'x', map: MAP }), ctx)).status).toBe(404);
    h.getSession.mockResolvedValueOnce(row({ courseCode: 'GC 1010' }));
    expect((await PUT(json('PUT', { sessionId: 'sess-1', map: MAP }), ctx)).status).toBe(404);
    expect(h.saveEdited).not.toHaveBeenCalled();
  });
  it('401 when unauthorized', async () => {
    h.auth.mockResolvedValue(false);
    expect((await PUT(json('PUT', { sessionId: 'sess-1', map: MAP }), ctx)).status).toBe(401);
  });
});

describe('GET', () => {
  const get = () => GET(new Request(url('&sessionId=sess-1')), ctx);

  it('returns the stored map when the materials are unchanged', async () => {
    h.getSession.mockResolvedValue(row({ materialsFingerprint: materialsFingerprint([mat('a')]) }));
    expect(await (await get()).json()).toEqual({ sessionId: 'sess-1', map: MAP, status: 'ready' });
    expect(h.runPreRead).not.toHaveBeenCalled();
  });
  it('re-runs the pre-read and saves it when the materials changed before any assistant turn', async () => {
    const fresh = { ...MAP, summary: 'new' };
    h.getSession.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ map: fresh, mapStatus: 'ready', materialsFingerprint: 'fp2' }));
    h.runPreRead.mockResolvedValue({ map: fresh, status: 'ready', fingerprint: 'fp2' });
    expect(await (await get()).json()).toEqual({ sessionId: 'sess-1', map: fresh, status: 'ready' });
    expect(h.saveMap).toHaveBeenCalledWith('sess-1', { map: fresh, status: 'ready', fingerprint: 'fp2' });
  });
  it('does not re-run once the interview has an assistant turn', async () => {
    h.getSession.mockResolvedValue(row());
    h.messages.mockResolvedValue([{ role: 'assistant' }]);
    await get();
    expect(h.runPreRead).not.toHaveBeenCalled();
  });
  it('does not overwrite an edited map or a read still in flight', async () => {
    h.getSession.mockResolvedValueOnce(row({ mapEditedAt: new Date() }));
    await get();
    h.getSession.mockResolvedValueOnce(row({ mapStatus: 'pending', map: null }));
    await get();
    expect(h.runPreRead).not.toHaveBeenCalled();
  });
  it('404 for another course\'s session', async () => {
    h.getSession.mockResolvedValue(row({ courseCode: 'GC 1010' }));
    expect((await get()).status).toBe(404);
  });

  it('two concurrent GETs on a stale-fingerprint session start one read', async () => {
    h.getSession.mockResolvedValue(row());
    let claimed = false;
    h.claim.mockImplementation(async () => { if (claimed) return false; claimed = true; return true; });
    h.runPreRead.mockResolvedValue({ map: MAP, status: 'ready', fingerprint: 'fp2' });
    const [a, b] = await Promise.all([get(), get()]);
    expect(h.runPreRead).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('a pending row started recently is not re-read; a stale one is, whatever the fingerprint', async () => {
    h.getSession.mockResolvedValueOnce(row({ mapStatus: 'pending', map: null, materialsFingerprint: materialsFingerprint([mat('a')]) }));
    await get();
    expect(h.runPreRead).not.toHaveBeenCalled();
    h.getSession.mockResolvedValueOnce(row({ mapStatus: 'pending', map: null, materialsFingerprint: materialsFingerprint([mat('a')]), mapStartedAt: new Date(Date.now() - 241_000) }));
    h.runPreRead.mockResolvedValue({ map: MAP, status: 'ready', fingerprint: 'fp' });
    await get();
    expect(h.claim).toHaveBeenCalledWith('sess-1');
    expect(h.runPreRead).toHaveBeenCalledTimes(1);
  });

  it('does not read when the claim is refused', async () => {
    h.getSession.mockResolvedValue(row());
    h.claim.mockResolvedValue(false);
    await get();
    expect(h.runPreRead).not.toHaveBeenCalled();
  });

  it('does not re-read a failed map with a null fingerprint on every poll, but does when a stored fingerprint differs', async () => {
    h.getSession.mockResolvedValueOnce(row({ mapStatus: 'failed', map: null, materialsFingerprint: null }));
    await get();
    expect(h.runPreRead).not.toHaveBeenCalled();
    h.getSession.mockResolvedValueOnce(row({ mapStatus: 'failed', map: null, materialsFingerprint: 'old' }));
    h.runPreRead.mockResolvedValue({ map: MAP, status: 'ready', fingerprint: 'fp' });
    await get();
    expect(h.runPreRead).toHaveBeenCalledTimes(1);
  });
});

describe('edited rows never stay pending', () => {
  const get = () => GET(new Request(url('&sessionId=sess-1')), ctx);
  const old = () => new Date(Date.now() - 241_000);
  it('GET settles an edited row whose read died (pending and stale) to ready', async () => {
    h.getSession.mockResolvedValue(row({ mapEditedAt: new Date(), mapStatus: 'pending', mapStartedAt: old() }));
    const res = await get();
    expect(h.markReady).toHaveBeenCalledWith('sess-1');
    expect((await res.json()).status).toBe('ready');
    expect(h.runPreRead).not.toHaveBeenCalled();
  });
  it('GET leaves an edited row whose read is still in flight pending', async () => {
    h.getSession.mockResolvedValue(row({ mapEditedAt: new Date(), mapStatus: 'pending' }));
    const res = await get();
    expect(h.markReady).not.toHaveBeenCalled();
    expect((await res.json()).status).toBe('pending');
  });
  it('PUT settles the row to ready when no read is in flight (failed, or pending but stale)', async () => {
    h.getSession.mockResolvedValueOnce(row({ mapStatus: 'failed', map: null }));
    expect((await (await PUT(json('PUT', { sessionId: 'sess-1', map: MAP }), ctx)).json()).status).toBe('ready');
    h.getSession.mockResolvedValueOnce(row({ mapStatus: 'pending', mapStartedAt: old() }));
    expect((await (await PUT(json('PUT', { sessionId: 'sess-1', map: MAP }), ctx)).json()).status).toBe('ready');
    expect(h.markReady).toHaveBeenCalledTimes(2);
  });
  it('PUT leaves a fresh pending read pending (its save will settle it)', async () => {
    h.getSession.mockResolvedValueOnce(row({ mapStatus: 'pending' }));
    expect((await (await PUT(json('PUT', { sessionId: 'sess-1', map: MAP }), ctx)).json()).status).toBe('pending');
    expect(h.markReady).not.toHaveBeenCalled();
  });
});

describe('PUT size', () => {
  it('413 for a body over 256 KB', async () => {
    const big = JSON.stringify({ sessionId: 'sess-1', map: { ...MAP, summary: 'x'.repeat(300_000) } });
    const res = await PUT(new Request(url(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: big }), ctx);
    expect(res.status).toBe(413);
    expect(h.saveEdited).not.toHaveBeenCalled();
  });
  it('400 for a map over the field limits', async () => {
    const res = await PUT(json('PUT', { sessionId: 'sess-1', map: { ...MAP, summary: 'x'.repeat(2001) } }), ctx);
    expect(res.status).toBe(400);
  });
});
