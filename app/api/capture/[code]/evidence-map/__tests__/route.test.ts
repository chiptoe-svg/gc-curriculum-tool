import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(), rate: vi.fn(), cap: vi.fn(), runPreRead: vi.fn(), createSession: vi.fn(), getSession: vi.fn(),
  saveMap: vi.fn(), saveEdited: vi.fn(), messages: vi.fn(), materials: vi.fn(),
}));
vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: h.auth }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: h.rate }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: h.cap }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 3460' }) }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ startNewSession: () => 'sess-1', getSessionMessages: h.messages }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: h.materials }));
vi.mock('@/lib/db/capture-interview-sessions-queries', () => ({
  createInterviewSession: h.createSession, getInterviewSession: h.getSession, saveEvidenceMap: h.saveMap, saveEditedEvidenceMap: h.saveEdited,
}));
vi.mock('@/lib/capture/staged/pre-read', async (orig) => ({ ...(await orig<typeof import('@/lib/capture/staged/pre-read')>()), runPreRead: h.runPreRead }));

import { POST, GET, PUT } from '../route';
import { materialsFingerprint } from '@/lib/capture/staged/pre-read';

const ctx = { params: Promise.resolve({ code: 'GC%203460' }) };
const url = (q = '') => `http://x/api/capture/GC%203460/evidence-map?slug=s${q}`;
const json = (method: string, body: unknown, q = '') => new Request(url(q), { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const MAP = { summary: 's', graded_work: [], tests: [], competencies: [], assumed_skills: [], objectives: [], conflicts: [], unreadable: [] };
const mat = (id: string) => ({ id, fileName: `${id}.pdf`, digest: 'd', extractionStatus: 'ok', ignored: false, autoSetAside: false, retiredAt: null, ignoredItems: [], uploadedAt: new Date('2026-11-01T00:00:00Z') });
const row = (over: Record<string, unknown> = {}) => ({ sessionId: 'sess-1', courseCode: 'GC 3460', map: MAP, mapStatus: 'ready', materialsFingerprint: 'old', mapEditedAt: null, createdAt: new Date(), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue(true);
  h.rate.mockResolvedValue({ allowed: true });
  h.cap.mockResolvedValue({ ok: true });
  h.messages.mockResolvedValue([]);
  h.materials.mockResolvedValue([mat('a')]);
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
    h.getSession.mockResolvedValue(row());
    const fresh = { ...MAP, summary: 'new' };
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
});
