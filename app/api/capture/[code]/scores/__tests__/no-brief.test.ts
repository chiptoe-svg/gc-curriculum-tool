import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
const mockPrereqProfile = vi.hoisted(() => ({
  course_code: 'GC 1040',
  scale_version: 'v1',
  generated_at: '2026-01-01T00:00:00.000Z',
  overview: null,
  competencies: [
    { statement: 'Operate a proof press', type: 'technical', k_depth: 2, u_depth: 1, d_depth: 3, evidence_k: 'e', evidence_u: 'e', evidence_d: 'e', rationale: 'r', source: 'instructor' },
  ],
  incoming_expectations: [],
  verification_summary: { course_shape: 'x', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'x' },
  audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [] },
  revised_objectives_draft: null,
  course_emphasis: null,
}));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn(async (code: string) => code === 'GC 1040'
    ? { code: 'GC 1040', title: 'Intro to Print', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [] }
    : { code: 'GC 3460', title: 'Flexo', description: '', prerequisites: 'GC 1040', learningObjectives: [], majorProjects: [], skillsRequired: [] }),
}));
vi.mock('@/lib/db/course-profile-queries', () => ({ getCourseProfile: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({
  getCaptureProfileByCourse: vi.fn().mockResolvedValue(null),
  upsertCaptureProfile: vi.fn(),
  setCaptureProfileStatus: vi.fn(),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({
  getLatestSnapshotByCourse: vi.fn(async (code: string) => code === 'GC 1040'
    ? { profile: mockPrereqProfile, createdAt: new Date('2026-01-01T00:00:00Z'), caption: null }
    : null),
}));
vi.mock('@/lib/db/capture-messages-queries', () => ({
  getLatestSessionId: vi.fn().mockResolvedValue(null),
  getSessionMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/curriculum/sheet-prereq-graph', async (orig) => ({
  ...(await orig<typeof import('@/lib/curriculum/sheet-prereq-graph')>()),
  loadSheetPrereqPairs: vi.fn().mockResolvedValue([{ focal: 'GC 4060', prereq: 'GC 3460' }]),
}));
const gen = vi.fn().mockRejectedValue(new Error('stop after capture'));
vi.mock('@/lib/ai/analyze/capture-scores', () => ({ generateCaptureProfileV2: (...a: unknown[]) => gen(...a) }));

import { POST } from '@/app/api/capture/[code]/scores/route';
import { BRIEF_HEADING } from '@/lib/capture/course-context-brief';
import { PREREQ_PROFILES_HEADING } from '@/lib/capture/prereq-profiles-block';

describe('scoring context', () => {
  it('never receives the course-context brief or the prerequisite-profiles block, even with a captured prerequisite', async () => {
    await POST(
      new Request('http://x/api/capture/GC%203460/scores?slug=s', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }),
      { params: Promise.resolve({ code: 'GC%203460' }) },
    ).catch(() => undefined);
    expect(gen).toHaveBeenCalled();
    const passed = JSON.stringify(gen.mock.calls[0]);
    expect(passed).not.toContain(BRIEF_HEADING);
    expect(passed).not.toContain('Neighboring courses');
    expect(passed).not.toContain(PREREQ_PROFILES_HEADING);
  });
});
