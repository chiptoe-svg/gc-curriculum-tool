import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { void fn(); },
}));
const mockGetCourse = vi.fn();
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: (...a: unknown[]) => mockGetCourse(...a),
  clearCourseCanvasImport: vi.fn(),
}));
const mockInsert = vi.fn();
const mockList = vi.fn();
const mockTier = vi.fn();
const mockSessionCourse = vi.fn();
const mockStatus = vi.fn();
vi.mock('@/lib/db/course-materials-queries', () => ({
  insertMaterial: (...a: unknown[]) => mockInsert(...a),
  listMaterialsByCourse: (...a: unknown[]) => mockList(...a),
  deleteMaterial: vi.fn(),
  updateMaterialTier: (...a: unknown[]) => mockTier(...a),
  getCaptureSessionCourse: (...a: unknown[]) => mockSessionCourse(...a),
  getMaterialStatusInCourse: (...a: unknown[]) => mockStatus(...a),
}));
vi.mock('@/lib/capture/vector-store', () => ({ createVectorStore: vi.fn(), tenantForCourse: (c: string) => c }));
const mockEnqueue = vi.fn();
vi.mock('@/lib/capture/ingest-queue', () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a) }));
vi.mock('@/lib/capture/syllabus-replace', () => ({ supersedeOlderSyllabi: vi.fn() }));
let triage = true;
vi.mock('@/lib/capture/triage-flag', () => ({ isTriageEnabled: () => triage }));
vi.mock('@/lib/capture/size-probe', () => ({ probeSize: vi.fn(async () => ({ sizeBytes: 1, pageCount: 1, slideCount: null })) }));
vi.mock('@/lib/capture/material-tier', () => ({ classifyManifestItem: vi.fn(async () => 'background') }));
vi.mock('@/lib/storage/local-storage', () => ({
  putLocal: vi.fn(async () => ({ url: 'local:k' })), courseSlug: (c: string) => c, safeFilename: (f: string) => f,
  keyFromLocalUrl: vi.fn(), deleteLocal: vi.fn(),
}));
vi.mock('@/lib/ip-hash', () => ({ hashIp: () => 'h' }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/courses/material-extractor', () => ({ SUPPORTED_MIME_TYPES: ['application/pdf'], LEGACY_OFFICE_MIME_TYPES: [] }));
vi.mock('@/lib/auth/viewer', () => ({
  getRequestGrant: async () => ({ id: 'g', label: 'T', scope: ['*'], can: ['capture', 'create'] }),
}));

import { POST } from '../route';
import { GET as STATUS } from '@/app/api/capture/[code]/ingest-status/route';

const SID = '11111111-1111-4111-8111-111111111111';
function post(name = 'a.pdf', sessionId?: string) {
  const f = new FormData();
  f.set('slug', 'valid-slug');
  f.set('file', new Blob(['hello'], { type: 'application/pdf' }), name);
  if (sessionId) f.set('sessionId', sessionId);
  // The test env's multipart round trip drops the file name, so hand the route the form directly.
  const rq = new Request('http://h/api/courses/GC%201010/materials', { method: 'POST' });
  rq.formData = async () => f;
  return [
    rq,
    { params: Promise.resolve({ code: 'GC 1010' }) },
  ] as const;
}

beforeEach(() => {
  vi.resetAllMocks();
  triage = true;
  mockGetCourse.mockResolvedValue({ code: 'GC 1010' });
  mockList.mockResolvedValue([]);
  mockSessionCourse.mockResolvedValue('GC 1010');
  let n = 0;
  mockInsert.mockImplementation(async (i: Record<string, unknown>) => ({
    id: `m${++n}`, fileName: i.fileName, blobUrl: 'local:k', addedInSession: i.addedInSession ?? null,
    courseCode: 'GC 1010', sourceCode: null,
  }));
});

describe('POST materials from the interview', () => {
  it('an interview file is stored with its session, tier high, and enqueued even with triage on', async () => {
    const [r, c] = post('a.pdf', SID);
    const res = await POST(r, c);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ addedInSession: SID }));
    expect(mockTier).toHaveBeenCalledWith('m1', 'high');
    expect(mockEnqueue).toHaveBeenCalledWith('m1');
    expect(body).toMatchObject({ id: 'm1', indexingStatus: 'queued', addedInSession: SID, duplicateOf: null });
  });

  it('a session from another course is refused', async () => {
    mockSessionCourse.mockResolvedValue('GC 2000');
    const [r, c] = post('a.pdf', SID);
    const res = await POST(r, c);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('That interview session is not for this course.');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('duplicate points at the existing file and stores nothing', async () => {
    mockList.mockResolvedValue([
      { id: 'old', fileName: 'a.pdf', sizeBytes: 5, ignored: false, indexingStatus: 'ready' },
    ]);
    const [r, c] = post('a.pdf', SID);
    const res = await POST(r, c);
    expect(await res.json()).toMatchObject({ id: 'old', duplicateOf: 'old', indexingStatus: 'ready' });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it.each(['pending', 'failed', 'queued'])('a %s duplicate is read now: tier high, enqueued, reported queued', async (st) => {
    mockList.mockResolvedValue([
      { id: 'old', fileName: 'a.pdf', sizeBytes: 5, ignored: false, autoSetAside: false, setAsideReason: null, indexingStatus: st },
    ]);
    const res = await POST(...post('a.pdf', SID));
    expect(await res.json()).toMatchObject({ id: 'old', duplicateOf: 'old', indexingStatus: 'queued' });
    expect(mockTier).toHaveBeenCalledWith('old', 'high');
    expect(mockEnqueue).toHaveBeenCalledWith('old');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('an indexing duplicate is left alone (already being read)', async () => {
    mockList.mockResolvedValue([
      { id: 'old', fileName: 'a.pdf', sizeBytes: 5, ignored: false, autoSetAside: false, setAsideReason: null, indexingStatus: 'indexing' },
    ]);
    const res = await POST(...post('a.pdf', SID));
    expect(await res.json()).toMatchObject({ id: 'old', duplicateOf: 'old', indexingStatus: 'indexing' });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('a set-aside duplicate is not enqueued and is reported as set aside', async () => {
    mockList.mockResolvedValue([
      { id: 'old', fileName: 'a.pdf', sizeBytes: 5, ignored: false, autoSetAside: true, setAsideReason: 'looks like student work', indexingStatus: 'pending' },
    ]);
    const res = await POST(...post('a.pdf', SID));
    expect(await res.json()).toMatchObject({ id: 'old', duplicateOf: 'old', indexingStatus: 'pending', setAside: true });
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockTier).not.toHaveBeenCalled();
  });

  it('two interview files back to back both enqueue', async () => {
    await POST(...post('a.pdf', SID));
    await POST(...post('b.pdf', SID));
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  it('an upload without a session behaves as before', async () => {
    const res = await POST(...post('a.pdf'));
    expect(res.status).toBe(200);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockTier).not.toHaveBeenCalledWith('m1', 'high');
    expect((await res.json()).indexingStatus).toBe('pending');
  });
});

describe('ingest-status ?id=', () => {
  const call = (q: string) => STATUS(
    new Request(`http://h/api/capture/GC%201010/ingest-status?slug=valid-slug${q}`),
    { params: Promise.resolve({ code: 'GC 1010' }) },
  );
  it('reports that material, and 404 for another course\'s', async () => {
    mockStatus.mockImplementation(async (c: string, id: string) =>
      c === 'GC 1010' && id === 'x' ? { id: 'x', indexingStatus: 'ready', extractionStatus: 'done' } : null);
    const ok = await call('&id=x');
    expect(await ok.json()).toEqual({ id: 'x', indexingStatus: 'ready', extractionStatus: 'done' });
    const miss = await call('&id=other-course-material');
    expect(miss.status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });
});
