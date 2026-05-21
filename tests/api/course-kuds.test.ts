import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCourseByCode, updateBuilderStatus } = vi.hoisted(() => ({
  getCourseByCode: vi.fn(),
  updateBuilderStatus: vi.fn(),
}));
const { generateCourseKud } = vi.hoisted(() => ({ generateCourseKud: vi.fn() }));
const { insertKudRun, upsertCourseKud, saveKudDraft, acceptCourseKud, getCourseKud } = vi.hoisted(() => ({
  insertKudRun: vi.fn(),
  upsertCourseKud: vi.fn(),
  saveKudDraft: vi.fn(),
  acceptCourseKud: vi.fn(),
  getCourseKud: vi.fn(),
}));
const { checkIpRateLimit } = vi.hoisted(() => ({ checkIpRateLimit: vi.fn() }));
const { hashIp } = vi.hoisted(() => ({ hashIp: vi.fn().mockReturnValue('hashed-ip') }));

vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode, updateBuilderStatus }));
vi.mock('@/lib/ai/analyze/kud-generate', () => ({ generateCourseKud }));
vi.mock('@/lib/db/course-kud-queries', () => ({ insertKudRun, upsertCourseKud, saveKudDraft, acceptCourseKud, getCourseKud }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit }));
vi.mock('@/lib/ip-hash', () => ({ hashIp }));
vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));

import { POST as generatePost } from '@/app/api/courses/[code]/kuds/generate/route';
import { PUT as kudsPut } from '@/app/api/courses/[code]/kuds/route';
import { POST as acceptPost } from '@/app/api/courses/[code]/kuds/accept/route';

const ctx = { params: Promise.resolve({ code: 'GC%203460' }) };

const fakeCourse = {
  code: 'GC 3460', title: 'Ink and Substrates', level: 3, track: 'Print',
  description: 'Advanced print.', prerequisites: '', syllabusUrl: null,
  learningObjectives: ['obj1'], majorProjects: ['proj1'], skillsRequired: ['skill1'],
  lastSyncedAt: new Date(), builderStatus: 'profile_complete',
};

const fakeKudResult = {
  thresholdConcept: 'Color is physical.',
  know: ['CMYK model', 'Halftone mechanics', 'Substrate types'],
  understand: ['Why dot gain matters', 'How adhesion works', 'Why process choice matters'],
  do: ['Select Pantone standard', 'Conduct ink testing', 'Interpret results'],
  confidenceNotes: 'Strong Do evidence.',
};

beforeEach(() => {
  vi.clearAllMocks();
  updateBuilderStatus.mockResolvedValue(undefined);
  insertKudRun.mockResolvedValue('run-uuid-1');
  upsertCourseKud.mockResolvedValue(undefined);
  saveKudDraft.mockResolvedValue(undefined);
  acceptCourseKud.mockResolvedValue(undefined);
  checkIpRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
});

describe('POST /api/courses/[code]/kuds/generate', () => {
  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/kuds/generate?slug=bad', { method: 'POST' });
    const res = await generatePost(req, ctx);
    expect(res.status).toBe(401);
  });

  it('404s when course not found', async () => {
    getCourseByCode.mockResolvedValue(null);
    const req = new Request('http://test/api/courses/GC%203460/kuds/generate?slug=valid-slug', { method: 'POST' });
    const res = await generatePost(req, ctx);
    expect(res.status).toBe(404);
  });

  it('429s when rate limited', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    checkIpRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const req = new Request('http://test/api/courses/GC%203460/kuds/generate?slug=valid-slug', { method: 'POST' });
    const res = await generatePost(req, ctx);
    expect(res.status).toBe(429);
  });

  it('generates KUDs and returns draft', async () => {
    getCourseByCode.mockResolvedValue(fakeCourse);
    generateCourseKud.mockResolvedValue({ data: fakeKudResult, telemetry: { costUsdCents: 12, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 50 } });
    const req = new Request('http://test/api/courses/GC%203460/kuds/generate?slug=valid-slug', { method: 'POST' });
    const res = await generatePost(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBe('run-uuid-1');
    expect(body.draft.thresholdConcept).toBe('Color is physical.');
    expect(updateBuilderStatus).toHaveBeenCalledWith('GC 3460', 'kuds_generated');
  });
});

describe('PUT /api/courses/[code]/kuds', () => {
  function makeReq(body: unknown) {
    return new Request('http://test/api/courses/GC%203460/kuds?slug=valid-slug', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/kuds?slug=bad', { method: 'PUT', body: '{}' });
    const res = await kudsPut(req, ctx);
    expect(res.status).toBe(401);
  });

  it('saves the draft and returns 200', async () => {
    getCourseKud.mockResolvedValue({ thresholdConcept: 'original', know: ['orig1', 'orig2', 'orig3'], understand: ['orig1', 'orig2', 'orig3'], do: ['orig1', 'orig2', 'orig3'] });
    const res = await kudsPut(makeReq({
      thresholdConcept: 'Color is physical.',
      know: ['CMYK model', 'Halftone mechanics', 'Substrate types'],
      understand: ['Why dot gain matters', 'How adhesion works', 'Why process choice matters'],
      do: ['Select Pantone standard', 'Conduct ink testing', 'Interpret results'],
    }), ctx);
    expect(res.status).toBe(200);
    expect(saveKudDraft).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/courses/[code]/kuds/accept', () => {
  it('401s on invalid slug', async () => {
    const req = new Request('http://test/api/courses/GC%203460/kuds/accept?slug=bad', { method: 'POST' });
    const res = await acceptPost(req, ctx);
    expect(res.status).toBe(401);
  });

  it('404s when no KUD record exists', async () => {
    getCourseKud.mockResolvedValue(null);
    const req = new Request('http://test/api/courses/GC%203460/kuds/accept?slug=valid-slug', { method: 'POST' });
    const res = await acceptPost(req, ctx);
    expect(res.status).toBe(404);
  });

  it('accepts KUDs and returns 200', async () => {
    getCourseKud.mockResolvedValue({ courseCode: 'GC 3460', thresholdConcept: 'Color is physical.', know: [], understand: [], do: [] });
    const req = new Request('http://test/api/courses/GC%203460/kuds/accept?slug=valid-slug', { method: 'POST' });
    const res = await acceptPost(req, ctx);
    expect(res.status).toBe(200);
    expect(acceptCourseKud).toHaveBeenCalledWith('GC 3460', expect.any(Date), 'hashed-ip');
    expect(updateBuilderStatus).toHaveBeenCalledWith('GC 3460', 'approved');
  });
});
