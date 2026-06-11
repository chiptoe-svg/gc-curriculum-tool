import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: vi.fn() }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn(),
  updateBuilderStatus: vi.fn(),
}));
vi.mock('@/lib/db/course-kud-queries', () => ({
  insertKudRun: vi.fn().mockResolvedValue('run-123'),
  upsertCourseKud: vi.fn(),
}));
vi.mock('@/lib/ai/analyze/kud-generate', () => ({ generateCourseKud: vi.fn() }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/rate-limit/daily-cap', () => ({
  checkDailyCap: vi.fn().mockResolvedValue({ ok: true, spentCents: 0 }),
  recordSpend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('testhash') }));

import { POST } from '@/app/api/courses/[code]/kuds/generate/route';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode, updateBuilderStatus } from '@/lib/db/courses-queries';
import { insertKudRun, upsertCourseKud } from '@/lib/db/course-kud-queries';
import { generateCourseKud } from '@/lib/ai/analyze/kud-generate';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

const mockIsValidSlug = isValidSlug as ReturnType<typeof vi.fn>;
const mockGetCourseByCode = getCourseByCode as ReturnType<typeof vi.fn>;
const mockUpdateBuilderStatus = updateBuilderStatus as ReturnType<typeof vi.fn>;
const mockInsertKudRun = insertKudRun as ReturnType<typeof vi.fn>;
const mockUpsertCourseKud = upsertCourseKud as ReturnType<typeof vi.fn>;
const mockGenerateCourseKud = generateCourseKud as ReturnType<typeof vi.fn>;
const mockCheckIpRateLimit = checkIpRateLimit as ReturnType<typeof vi.fn>;
const mockCheckDailyCap = checkDailyCap as ReturnType<typeof vi.fn>;
const mockRecordSpend = recordSpend as ReturnType<typeof vi.fn>;
const mockHashIp = hashIp as ReturnType<typeof vi.fn>;

const FAKE_COURSE = {
  code: 'GC 3460',
  title: 'Offset Lithography',
  description: 'An introduction to offset printing.',
  learningObjectives: ['Operate a press', 'Mix ink'],
  majorProjects: ['Final press run'],
  skillsRequired: ['Basic color theory'],
};

const FAKE_KUD_RESULT = {
  thresholdConcept: 'Ink viscosity',
  know: ['Ink types'],
  understand: ['How viscosity affects print quality'],
  do: ['Measure and adjust ink viscosity'],
};

function makeReq(body: unknown, code = 'GC%203460', slug = 'valid-slug') {
  return [
    new Request(`http://x/api/courses/${code}/kuds/generate?slug=${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code }) },
  ] as const;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockIsValidSlug.mockReturnValue(true);
  mockGetCourseByCode.mockResolvedValue(FAKE_COURSE);
  mockGenerateCourseKud.mockResolvedValue({
    data: FAKE_KUD_RESULT,
    telemetry: { costUsdCents: 5 },
  });
  mockInsertKudRun.mockResolvedValue('run-123');
  mockUpsertCourseKud.mockResolvedValue(undefined);
  mockUpdateBuilderStatus.mockResolvedValue(undefined);
  mockCheckIpRateLimit.mockResolvedValue({ allowed: true });
  mockCheckDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
  mockRecordSpend.mockResolvedValue(undefined);
  mockHashIp.mockReturnValue('testhash');
});

describe('POST /api/courses/[code]/kuds/generate', () => {
  it('returns 401 when isValidSlug returns false', async () => {
    mockIsValidSlug.mockReturnValue(false);
    const [req, ctx] = makeReq({});
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    mockCheckIpRateLimit.mockResolvedValueOnce({ allowed: false });
    const [req, ctx] = makeReq({});
    const res = await POST(req, ctx);
    expect(res.status).toBe(429);
  });

  it('returns 404 when getCourseByCode returns null', async () => {
    mockGetCourseByCode.mockResolvedValue(null);
    const [req, ctx] = makeReq({});
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 200 with runId and draft on a valid request', async () => {
    const [req, ctx] = makeReq({});
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ runId: 'run-123', draft: FAKE_KUD_RESULT });
  });

  it('returns 500 when generateCourseKud throws', async () => {
    mockGenerateCourseKud.mockRejectedValueOnce(new Error('AI down'));
    const [req, ctx] = makeReq({});
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
  });

  it('passes conversationContext when conversationHistory is provided', async () => {
    const history = [
      { role: 'assistant', content: 'What is the highest-stakes assignment?' },
      { role: 'user', content: 'Students do a capstone data pipeline project.' },
    ];
    const [req, ctx] = makeReq({ conversationHistory: history });
    await POST(req, ctx);
    const callArgs = mockGenerateCourseKud.mock.calls[0]![0];
    expect(callArgs.conversationContext).toContain('capstone data pipeline');
  });
});
