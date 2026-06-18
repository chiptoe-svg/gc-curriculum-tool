/**
 * TDD: snapshots route POST — clearRawBlobsForCourse hook
 *
 * With isTriageEnabled() = true → clearRawBlobsForCourse(code) is called after createSnapshot.
 * With isTriageEnabled() = false → clearRawBlobsForCourse is NOT called.
 * clearRawBlobsForCourse rejection must NOT fail the snapshot response (best-effort).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Auth / slug ─────────────────────────────────────────────────────────────
vi.mock('@/lib/sandbox/access', () => ({
  authorizeCourseWrite: async () => true,
  resolveScopedSession: async () => null,
}));

// ── IP rate-limit ────────────────────────────────────────────────────────────
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({
  checkIpRateLimit: async () => ({ allowed: true }),
}));
vi.mock('@/lib/ip-hash', () => ({
  hashIp: () => 'testhash',
}));

// ── courses-queries ──────────────────────────────────────────────────────────
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: async () => ({
    code: 'GC 4440',
    title: 'Test Course',
    description: 'desc',
    prerequisites: '',
    learningObjectives: [],
    majorProjects: [],
    skillsRequired: [],
    auditMode: 'full',
    canvasCourseName: null,
    canvasImportedAt: null,
    pairedCodes: [],
  }),
}));

// ── capture-profile-queries ──────────────────────────────────────────────────
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({
  getCaptureProfileByCourse: async () => ({
    profile: { competencies: [] },
    reviewerNote: null,
  }),
  setCaptureProfileStatus: vi.fn(async () => {}),
}));

// ── capture-conversations-queries ────────────────────────────────────────────
vi.mock('@/lib/db/capture-conversations-queries', () => ({
  getCaptureConversation: async () => null,
}));

// ── capture-messages-queries ─────────────────────────────────────────────────
vi.mock('@/lib/db/capture-messages-queries', () => ({
  getLatestSessionId: async () => null,
  getSessionInstructor: async () => null,
}));

// ── course-profile-queries ───────────────────────────────────────────────────
vi.mock('@/lib/db/course-profile-queries', () => ({
  getCourseProfile: async () => null,
}));

// ── course-materials-queries ─────────────────────────────────────────────────
vi.mock('@/lib/db/course-materials-queries', () => ({
  listMaterialsByCourse: async () => [],
}));

// ── capture-snapshots-queries ────────────────────────────────────────────────
// Typed with _arg so TS doesn't error on the wrapper passing an argument
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createSnapshot = vi.fn(async (_arg?: any) => ({
  id: 'snap-1',
  courseCode: 'GC 4440',
  caption: null as string | null,
  captionNote: null as string | null,
  scaleVersion: '1.0',
  model: 'gpt-4o',
  createdAt: new Date().toISOString(),
  profile: {},
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getLatestSnapshotByCourse = vi.fn(async (_arg?: any) => null);
vi.mock('@/lib/db/capture-snapshots-queries', () => ({
  createSnapshot: (input: unknown) => createSnapshot(input),
  getLatestSnapshotByCourse: (code: unknown) => getLatestSnapshotByCourse(code),
  listSnapshotsByCourse: async () => [],
}));

// ── wiki update (fire-and-forget, don't await) ───────────────────────────────
vi.mock('@/lib/ai/wiki/update', () => ({
  updateWikiForSnapshot: async () => ({ raw: [], wiki: [], logEntry: null }),
}));
vi.mock('@/lib/wiki/git-ops', () => ({
  writeAndPush: async () => {},
}));

// ── clearRawBlobsForCourse ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clearRawBlobsForCourse = vi.fn(async (_arg?: any) => ({ cleared: 1 }));
vi.mock('@/lib/capture/clear-raw-blobs', () => ({
  clearRawBlobsForCourse: (code: unknown) => clearRawBlobsForCourse(code),
}));

// ── triage flag ──────────────────────────────────────────────────────────────
const isTriageEnabled = vi.fn(() => true);
vi.mock('@/lib/capture/triage-flag', () => ({
  isTriageEnabled: () => isTriageEnabled(),
}));

import { POST } from '@/app/api/capture/[code]/snapshots/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/capture/GC%204440/snapshots?slug=test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callPost(body: Record<string, unknown> = {}) {
  const params = Promise.resolve({ code: 'GC%204440' });
  return POST(makeRequest(body), { params });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('snapshots POST — clearRawBlobsForCourse hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire defaults after clearAllMocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createSnapshot.mockResolvedValue({
      id: 'snap-1',
      courseCode: 'GC 4440',
      caption: null as string | null,
      captionNote: null as string | null,
      scaleVersion: '1.0',
      model: 'gpt-4o',
      createdAt: new Date().toISOString(),
      profile: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    clearRawBlobsForCourse.mockResolvedValue({ cleared: 1 });
    isTriageEnabled.mockReturnValue(true);
  });

  it('calls clearRawBlobsForCourse(code) after createSnapshot when isTriageEnabled is true', async () => {
    const res = await callPost({ caption: 'Snapshot v1' });
    expect(res.status).toBe(200);
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    // Allow one tick for the await to settle
    await new Promise(r => setTimeout(r, 0));
    expect(clearRawBlobsForCourse).toHaveBeenCalledTimes(1);
    expect(clearRawBlobsForCourse).toHaveBeenCalledWith('GC 4440');
  });

  it('does NOT call clearRawBlobsForCourse when isTriageEnabled is false', async () => {
    isTriageEnabled.mockReturnValue(false);
    const res = await callPost({ caption: 'Snapshot v1' });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 0));
    expect(clearRawBlobsForCourse).not.toHaveBeenCalled();
  });

  it('returns 200 even when clearRawBlobsForCourse rejects (best-effort)', async () => {
    clearRawBlobsForCourse.mockRejectedValue(new Error('disk error'));
    const res = await callPost();
    expect(res.status).toBe(200);
    const body = await res.json() as { snapshot: { id: string } };
    expect(body.snapshot.id).toBe('snap-1');
  });

  it('snapshot response body is unaffected by clearRawBlobsForCourse behavior', async () => {
    const res = await callPost({ caption: 'Archived' });
    expect(res.status).toBe(200);
    const body = await res.json() as { snapshot: Record<string, unknown> };
    expect(body.snapshot).toHaveProperty('id', 'snap-1');
    expect(body.snapshot).toHaveProperty('model', 'gpt-4o');
  });
});
