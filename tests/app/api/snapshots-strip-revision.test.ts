/**
 * The draft's revision change list (spec 2026-11-08-course-revision-modes-labels-design.md)
 * never reaches an approved snapshot: the snapshots route strips it.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const upsertCaptureProfile = vi.fn(async (_arg?: any) => {});
// ── capture-profile-queries ──────────────────────────────────────────────────
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({
  getCaptureProfileByCourse: async () => ({
    profile: { competencies: [{ statement: 'A' }], revision: { mode: 'targeted', baseline_snapshot_id: 'snap-0', changes: [], stale_evidence: [], changed_sections: [] } },
    reviewerNote: null,
  }),
  setCaptureProfileStatus: vi.fn(async () => {}),
  upsertCaptureProfile: (input: unknown) => upsertCaptureProfile(input),
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updateWikiForSnapshot = vi.fn(async (_id?: any) => ({ raw: [], wiki: [], logEntry: null }));
vi.mock('@/lib/ai/wiki/update', () => ({
  updateWikiForSnapshot: (id: unknown) => updateWikiForSnapshot(id),
}));

// ── objective assessment guide (own fire-and-forget task) ───────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runObjectiveGuideForSnapshot = vi.fn(async (_id?: any) => ({ status: 'written' }));
vi.mock('@/lib/objective-guide/run', () => ({
  runObjectiveGuideForSnapshot: (id: unknown) => runObjectiveGuideForSnapshot(id),
}));

vi.mock('@/lib/wiki/git-ops', () => ({
  writeAndPush: async () => {},
}));

// ── program-index (cross-course spine, fire-and-log) ────────────────────────
vi.mock('@/lib/capture/program-index', () => ({
  refreshProgramIndex: vi.fn(async () => {}),
}));

// ── clearRawBlobsForCourse ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clearRawBlobsForCourse = vi.fn(async (_arg?: any) => ({ cleared: 1 }));
vi.mock('@/lib/capture/clear-raw-blobs', () => ({
  clearRawBlobsForCourse: (code: unknown) => clearRawBlobsForCourse(code),
}));

// ── triage flag ──────────────────────────────────────────────────────────────
const isTriageEnabled = vi.fn(() => true);
// Catalog-first prerequisite map; the course sheet line is not consulted.
const prereqCodesFor = vi.fn(async (_code?: unknown): Promise<string[]> => []);
vi.mock('@/lib/curriculum/prereq-map', () => ({
  prereqCodesFor: (code: unknown) => prereqCodesFor(code),
}));

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

describe('snapshots POST — revision change list', () => {
  beforeEach(() => { vi.clearAllMocks(); isTriageEnabled.mockReturnValue(false); });

  it('snapshot strips revision', async () => {
    const res = await callPost({ caption: 'v2' });
    expect(res.status).toBe(200);
    const frozen = createSnapshot.mock.calls[0]![0] as { profile: Record<string, unknown> };
    expect(frozen.profile).not.toHaveProperty('revision');
    expect(frozen.profile.competencies).toEqual([{ statement: 'A' }]);
  });

  it('M-5: approval clears the change list from the draft too', async () => {
    await callPost({ caption: 'v2' });
    expect(upsertCaptureProfile).toHaveBeenCalledTimes(1);
    const saved = upsertCaptureProfile.mock.calls[0]![0] as { profile: Record<string, unknown>; reviewerStatus: string };
    expect(saved.profile).not.toHaveProperty('revision');
    expect(saved.reviewerStatus).toBe('confirmed');
  });
});
