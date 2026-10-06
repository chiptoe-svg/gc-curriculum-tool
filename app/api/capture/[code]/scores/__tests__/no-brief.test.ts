import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 3460', title: 'Flexo', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [] }),
}));
vi.mock('@/lib/db/course-profile-queries', () => ({ getCourseProfile: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({
  getCaptureProfileByCourse: vi.fn().mockResolvedValue(null),
  upsertCaptureProfile: vi.fn(),
  setCaptureProfileStatus: vi.fn(),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: vi.fn().mockResolvedValue(null) }));
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

describe('scoring context', () => {
  it('never receives the course-context brief', async () => {
    await POST(
      new Request('http://x/api/capture/GC%203460/scores?slug=s', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }),
      { params: Promise.resolve({ code: 'GC%203460' }) },
    ).catch(() => undefined);
    expect(gen).toHaveBeenCalled();
    const passed = JSON.stringify(gen.mock.calls[0]);
    expect(passed).not.toContain(BRIEF_HEADING);
    expect(passed).not.toContain('Neighboring courses');
  });
});
