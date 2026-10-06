import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/capture-messages-queries', () => ({
  appendMessage: vi.fn(),
  getSessionMessages: vi.fn().mockResolvedValue([]),
  listPriorSessionSummaries: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 3460', title: 'Flexo', description: '', prerequisites: 'GC 1040', learningObjectives: [], majorProjects: [], skillsRequired: [] }),
}));
const mockSamplePrereqProfile = vi.hoisted(() => ({
  course_code: 'GC 1040',
  scale_version: 'v1',
  generated_at: '2026-01-01T00:00:00.000Z',
  overview: null,
  competencies: [
    {
      statement: 'Operate a proof press',
      type: 'technical',
      k_depth: 2,
      u_depth: 1,
      d_depth: 3,
      evidence_k: 'e',
      evidence_u: 'e',
      evidence_d: 'e',
      rationale: 'r',
      source: 'instructor',
    },
  ],
  incoming_expectations: [],
  verification_summary: { course_shape: 'x', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [], foundationals_glance: 'x' },
  audit_notes: { prereq_gaps: [], objective_misalignments: [], cross_source_conflicts: [], suggested_objective_revisions: [] },
  revised_objectives_draft: null,
  course_emphasis: null,
}));
vi.mock('@/lib/capture/course-context-brief', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/course-context-brief')>()),
  buildCourseContextBrief: vi.fn().mockResolvedValue({
    courseCode: 'GC 3460',
    prerequisites: [{ code: 'GC 1040', title: 'Intro to Print', captureLabel: 'GC 1040 capture snapshot 2026-01-01', profile: mockSamplePrereqProfile }],
    dependents: [{ code: 'GC 4060', title: 'Flexo Production', expectations: null, projects: { source: 'course sheet', items: ['Film run'] } }],
  }),
}));
vi.mock('@/lib/capture/prereq-profiles-block', async (orig) => {
  const mod = await orig<typeof import('@/lib/capture/prereq-profiles-block')>();
  return { ...mod, renderPrerequisiteProfiles: vi.fn(mod.renderPrerequisiteProfiles) };
});
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn().mockResolvedValue('SYSTEM') }));
vi.mock('@/lib/ai/agent/audit-tools', () => ({ buildAuditTools: vi.fn().mockReturnValue([]) }));

import { buildAgentCall } from '@/lib/ai/agent/audit-agent';
import { BRIEF_HEADING, buildCourseContextBrief } from '@/lib/capture/course-context-brief';
import { PREREQ_PROFILES_HEADING, renderPrerequisiteProfiles } from '@/lib/capture/prereq-profiles-block';

describe('interview at-rest context', () => {
  it('includes the course-context brief and the prerequisite profiles block', async () => {
    const built = await buildAgentCall({ sessionId: 's', courseCode: 'GC 3460', auditMode: 'full' });
    const first = built.messages[0];
    const atRest = String(first && 'content' in first ? first.content : '');
    expect(atRest).toContain(BRIEF_HEADING);
    expect(atRest).toContain('#### GC 4060 — Flexo Production');
    expect(atRest).toContain(PREREQ_PROFILES_HEADING);
    expect(atRest).toContain('- [technical] Operate a proof press (K2 U1 D3; source: instructor)');
  });

  it('is non-fatal when the brief fails to build', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(buildCourseContextBrief).mockRejectedValueOnce(new Error('db unreachable'));
    const built = await buildAgentCall({ sessionId: 's', courseCode: 'GC 3460', auditMode: 'full' });
    const first = built.messages[0];
    const atRest = String(first && 'content' in first ? first.content : '');
    expect(atRest).toContain('(course-context brief unavailable this turn)');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('keeps the brief when prerequisite-profile rendering throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(renderPrerequisiteProfiles).mockImplementationOnce(() => { throw new Error('boom'); });
    const built = await buildAgentCall({ sessionId: 's', courseCode: 'GC 3460', auditMode: 'full' });
    const first = built.messages[0];
    const atRest = String(first && 'content' in first ? first.content : '');
    expect(atRest).toContain(BRIEF_HEADING);
    expect(atRest).toContain('(prerequisite profiles unavailable this turn)');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
