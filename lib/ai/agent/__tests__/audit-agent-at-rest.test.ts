import { describe, it, expect, vi } from 'vitest';

const materials = vi.hoisted(() => [
  { id: 'm2', fileName: 'b-rubric.pdf', digest: 'Rubric digest', extractionStatus: 'ok', ignored: false, autoSetAside: false, retiredAt: null, ignoredItems: [] },
  { id: 'm1', fileName: 'a-syllabus.pdf', digest: null, extractionStatus: 'ok', ignored: false, autoSetAside: false, retiredAt: null, ignoredItems: [] },
  { id: 'm3', fileName: 'c-failed.pdf', digest: 'x', extractionStatus: 'failed', ignored: false, autoSetAside: false, retiredAt: null, ignoredItems: [] },
]);
const course = vi.hoisted(() => ({ code: 'GC 3460', title: 'Flexo', description: 'Desc', prerequisites: 'GC 1040', learningObjectives: ['O1', 'O2'], majorProjects: ['P1'], skillsRequired: ['S1'] }));

vi.mock('@/lib/db/capture-messages-queries', () => ({
  appendMessage: vi.fn(),
  getSessionMessages: vi.fn().mockResolvedValue([]),
  listPriorSessionSummaries: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue(materials) }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn().mockResolvedValue(course) }));
vi.mock('@/lib/capture/course-context-brief', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/course-context-brief')>()),
  buildCourseContextBrief: vi.fn().mockRejectedValue(new Error('skip')),
}));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn().mockResolvedValue('SYSTEM') }));
vi.mock('@/lib/ai/agent/audit-tools', () => ({ buildAuditTools: vi.fn().mockReturnValue([]) }));

import { buildAgentCall } from '@/lib/ai/agent/audit-agent';

const EXPECTED_HEAD = `# Course catalog

Course: GC 3460 — Flexo
Description: Desc
Prerequisites as written on the GC course sheet (may be out of date; the Clemson catalog list in the Neighboring courses brief is authoritative): GC 1040
Learning objectives: O1; O2
Major projects: P1
Declared incoming skills: S1

# Material digests

--- a-syllabus.pdf (id=m1) ---
(no digest)

--- b-rubric.pdf (id=m2) ---
Rubric digest

# Prior audit sessions (most recent)
`;

describe('at-rest context (output pinned before and after the renderAtRestContext extraction)', () => {
  it('opening-turn first message keeps its catalog and digest text exactly', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const built = await buildAgentCall({ sessionId: 's', courseCode: 'GC 3460', auditMode: 'full' });
    const first = built.messages[0] as { content: string };
    expect(first.content.startsWith(EXPECTED_HEAD)).toBe(true);
  });
});
