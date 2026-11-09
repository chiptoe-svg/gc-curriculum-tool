import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validProfile } from '@/tests/app/capture/fixtures/override-profile';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn(async () => ({ code: 'GC 3460', title: 'Flexo', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [], canvasImportedAt: null })),
}));
vi.mock('@/lib/db/course-profile-queries', () => ({ getCourseProfile: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/curriculum/prereq-map', () => ({ prereqCodesFor: vi.fn().mockResolvedValue([]) }));

const h = vi.hoisted(() => ({
  draft: null as null | { profile: unknown },
  sessionMode: null as null | { revisionMode: string; baselineSnapshotId: string | null },
  snapshot: null as null | { id: string; profile: unknown; retiredAt: Date | null; inputsMeta: unknown },
  scored: null as unknown,
  upsert: vi.fn(),
  gen: vi.fn(),
}));
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({
  getCaptureProfileByCourse: vi.fn(async () => h.draft),
  upsertCaptureProfile: (...a: unknown[]) => h.upsert(...a),
  setCaptureProfileStatus: vi.fn(),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({
  getLatestSnapshotByCourse: vi.fn().mockResolvedValue(null),
  getSnapshotById: vi.fn(async () => h.snapshot),
}));
vi.mock('@/lib/db/capture-messages-queries', () => ({
  getLatestSessionId: vi.fn().mockResolvedValue('sess-1'),
  getSessionMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/db/capture-sessions-queries', () => ({ getSessionMode: vi.fn(async () => h.sessionMode) }));
vi.mock('@/lib/capture/revision-evidence', () => ({
  buildCitationClassifiers: vi.fn(async () => ({ isNewCitation: () => false, isStaleCitation: () => false })),
}));
vi.mock('@/lib/ai/analyze/capture-scores', () => ({ generateCaptureProfileV2: (...a: unknown[]) => h.gen(...a) }));

import { POST } from '@/app/api/capture/[code]/scores/route';

function withComp(k: number, extra: Record<string, unknown> = {}): CaptureProfile {
  const p = validProfile();
  return { ...p, competencies: [{ ...p.competencies[0]!, k_depth: k, ...extra }] } as CaptureProfile;
}
const DRAFT = { ...withComp(2, { intended_target: { k: 4, u: null, d: null } }), adopted_from_scenario_id: 'scn-1' } as CaptureProfile;
const SNAPSHOT_PROFILE = withComp(3);

async function generate() {
  const res = await POST(
    new Request('http://x/api/capture/GC%203460/scores?slug=s', { method: 'POST', body: JSON.stringify({ messages: [] }) }),
    { params: Promise.resolve({ code: 'GC%203460' }) },
  );
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const priorPassed = () => (h.gen.mock.calls[0]![0] as { chatContext: { priorCaptureProfile: unknown } }).chatContext.priorCaptureProfile;
const upserted = () => (h.upsert.mock.calls[0]![0] as { profile: CaptureProfile }).profile;

describe('Generate with a stored revision mode', () => {
  beforeEach(() => {
    h.draft = { profile: DRAFT };
    h.sessionMode = null;
    h.snapshot = { id: 'snap-1', profile: SNAPSHOT_PROFILE, retiredAt: null, inputsMeta: { materials: [] } };
    h.upsert.mockReset();
    h.gen.mockReset();
    h.gen.mockImplementation(async () => ({ profile: withComp(1), telemetry: {}, model: 'm' }));
  });

  it('session without a row behaves as today', async () => {
    const { status } = await generate();
    expect(status).toBe(200);
    expect(priorPassed()).toEqual(DRAFT);
    expect(upserted().revision).toBeUndefined();
    expect(upserted().adopted_from_scenario_id).toBe('scn-1');
  });

  it('fresh passes no prior profile and drops the adopt overlay', async () => {
    h.sessionMode = { revisionMode: 'fresh', baselineSnapshotId: null };
    await generate();
    expect(priorPassed()).toBeNull();
    expect(upserted().adopted_from_scenario_id).toBeUndefined();
    expect(upserted().competencies[0]!.intended_target).toBeUndefined();
    expect(upserted().revision).toBeUndefined();
  });

  it('recheck anchors on the baseline snapshot, not the draft', async () => {
    h.sessionMode = { revisionMode: 'recheck', baselineSnapshotId: 'snap-1' };
    await generate();
    expect(priorPassed()).toEqual(SNAPSHOT_PROFILE);
    expect(upserted().revision!.mode).toBe('recheck');
    expect(upserted().revision!.changes[0]).toMatchObject({ kind: 'moved', decision: 'pending', dims: [{ dim: 'k', from: 3, to: 1 }] });
  });

  it('targeted attaches a revision block and sets no-evidence changes back', async () => {
    h.sessionMode = { revisionMode: 'targeted', baselineSnapshotId: 'snap-1' };
    await generate();
    const p = upserted();
    expect(p.revision!.mode).toBe('targeted');
    expect(p.revision!.baseline_snapshot_id).toBe('snap-1');
    expect(p.revision!.changes[0]).toMatchObject({ label: 'no_new_evidence', decision: 'undone' });
    expect(p.competencies[0]!.k_depth).toBe(3);
  });

  it('retired baseline returns 409 with the fixed message', async () => {
    h.sessionMode = { revisionMode: 'targeted', baselineSnapshotId: 'snap-1' };
    h.snapshot = { ...h.snapshot!, retiredAt: new Date('2026-11-07') };
    const { status, body } = await generate();
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'baseline_withdrawn', message: 'The approved version this revision started from was withdrawn. Start over to revise the current version.' });
    expect(h.gen).not.toHaveBeenCalled();
  });
});
