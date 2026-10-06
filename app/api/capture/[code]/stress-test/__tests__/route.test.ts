import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 3800', title: 'Seminar', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [] }),
}));
vi.mock('@/lib/db/course-profile-queries', () => ({ getCourseProfile: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({
  getCaptureProfileByCourse: vi.fn().mockResolvedValue({ profile: { competencies: [] }, reviewerStatus: 'ai_drafted' }),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/capture-messages-queries', () => ({
  getLatestSessionId: vi.fn().mockResolvedValue(null),
  getSessionMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({
  checkDailyCap: vi.fn().mockResolvedValue({ ok: true, spentCents: 0, overCap: false }),
  recordSpend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/ai/stress-test/run', () => ({ runStressTest: vi.fn() }));

import { POST } from '@/app/api/capture/[code]/stress-test/route';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import { runStressTest } from '@/lib/ai/stress-test/run';

const run = runStressTest as unknown as ReturnType<typeof vi.fn>;
const spend = recordSpend as unknown as ReturnType<typeof vi.fn>;

function call() {
  return POST(new Request('http://x/api/capture/GC%203800/stress-test?slug=s', { method: 'POST', body: '{}' }), {
    params: Promise.resolve({ code: 'GC%203800' }),
  });
}

describe('POST /api/capture/[code]/stress-test — spend', () => {
  beforeEach(() => { run.mockReset(); spend.mockClear(); });

  it('records the run\'s cost through the daily spend path (now that it runs automatically)', async () => {
    run.mockResolvedValue({
      result: { per_competency: [], profile_level: { catalog_vs_evidence_concerns: [], consistency_concerns: [], coverage_concerns: [] }, overall_assessment: 'sound', summary: 'ok' },
      telemetry: { costUsdCents: 1100, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
      model: 'gpt-6.1-sol',
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(spend).toHaveBeenCalledWith(1100);
  });

  it('records nothing when the model call fails', async () => {
    run.mockRejectedValue(new Error('boom'));
    const res = await call();
    expect(res.status).toBe(500);
    expect(spend).not.toHaveBeenCalled();
  });
});
