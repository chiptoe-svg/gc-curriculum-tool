import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authorizeCourseWrite, listMaterialsByCourse } = vi.hoisted(() => ({
  authorizeCourseWrite: vi.fn(async () => true),
  listMaterialsByCourse: vi.fn(),
}));
vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse }));

import { GET } from '@/app/api/capture/[code]/ingest-status/route';

beforeEach(() => {
  vi.clearAllMocks();
  authorizeCourseWrite.mockResolvedValue(true);
  listMaterialsByCourse.mockResolvedValue([
    { indexingStatus: 'ready', extractionStatus: 'ok', ignored: false, pageCount: 10, mimeType: 'application/pdf' },
    { indexingStatus: 'indexing', extractionStatus: 'ok', ignored: false, pageCount: 12, mimeType: 'application/pdf' },
    { indexingStatus: 'failed', extractionStatus: 'failed', ignored: false, pageCount: 8, mimeType: 'application/pdf' },
    { indexingStatus: 'ready', extractionStatus: 'ok', ignored: true, pageCount: 3, mimeType: 'application/pdf' },
  ]);
});

describe('GET /api/capture/[code]/ingest-status', () => {
  it('returns total/done/failed (excluding ignored) + an ETA', async () => {
    const req = new Request('http://x/api/capture/GC%203620/ingest-status?slug=s');
    const res = await GET(req, { params: Promise.resolve({ code: 'GC%203620' }) });
    const j = await res.json();
    expect(j.total).toBe(3); // ignored excluded
    expect(j.done).toBe(1); // ready & not ignored
    expect(j.failed).toBe(1);
    expect(j.etaSeconds).toBeGreaterThanOrEqual(0);
  });

  // PKSC 2200 (owner, 2026-10-28): a skipped file (an image with no text) is
  // settled, not waiting; counting it kept "14 of 15 done · est. 15 s left"
  // on screen forever.
  it('a skipped file is settled: not counted as waiting', async () => {
    listMaterialsByCourse.mockResolvedValue([
      { indexingStatus: 'ready', extractionStatus: 'ok', ignored: false, pageCount: 10, mimeType: 'application/pdf' },
      { indexingStatus: 'skipped', extractionStatus: 'low_text', ignored: false, pageCount: 1, mimeType: 'image/png' },
    ]);
    const req = new Request('http://x/api/capture/PKSC%202200/ingest-status?slug=s');
    const j = await (await GET(req, { params: Promise.resolve({ code: 'PKSC%202200' }) })).json();
    expect(j.done).toBe(j.total);
    expect(j.etaSeconds).toBe(0);
  });

  it('401s on an invalid slug', async () => {
    authorizeCourseWrite.mockResolvedValue(false);
    const req = new Request('http://x/api/capture/GC%203620/ingest-status?slug=bad');
    const res = await GET(req, { params: Promise.resolve({ code: 'GC%203620' }) });
    expect(res.status).toBe(401);
  });
});
