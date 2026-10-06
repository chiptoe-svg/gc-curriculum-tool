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
vi.mock('@/lib/capture/course-context-brief', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/course-context-brief')>()),
  buildCourseContextBrief: vi.fn().mockResolvedValue({
    courseCode: 'GC 3460',
    prerequisites: [],
    dependents: [{ code: 'GC 4060', title: 'Flexo Production', expectations: null, projects: { source: 'course sheet', items: ['Film run'] } }],
  }),
}));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn().mockResolvedValue('SYSTEM') }));
vi.mock('@/lib/ai/agent/audit-tools', () => ({ buildAuditTools: vi.fn().mockReturnValue([]) }));

import { buildAgentCall } from '@/lib/ai/agent/audit-agent';
import { BRIEF_HEADING, buildCourseContextBrief } from '@/lib/capture/course-context-brief';

describe('interview at-rest context', () => {
  it('includes the course-context brief', async () => {
    const built = await buildAgentCall({ sessionId: 's', courseCode: 'GC 3460', auditMode: 'full' });
    const first = built.messages[0];
    const atRest = String(first && 'content' in first ? first.content : '');
    expect(atRest).toContain(BRIEF_HEADING);
    expect(atRest).toContain('#### GC 4060 — Flexo Production');
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
});
