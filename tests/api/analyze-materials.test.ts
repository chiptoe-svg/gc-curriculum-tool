import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist all mocks before any imports ───────────────────────────────────────

const { applyAnalyzeGuards } = vi.hoisted(() => ({ applyAnalyzeGuards: vi.fn() }));
vi.mock('@/lib/ai/analyze/guards', () => ({ applyAnalyzeGuards }));

const { recordSpend } = vi.hoisted(() => ({
  recordSpend: vi.fn(),
}));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend }));

const { isValidSlug } = vi.hoisted(() => ({ isValidSlug: vi.fn() }));
vi.mock('@/lib/slug', () => ({ isValidSlug }));

const { getCourseByCode } = vi.hoisted(() => ({ getCourseByCode: vi.fn() }));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode }));

const { listMaterialsByCourse } = vi.hoisted(() => ({ listMaterialsByCourse: vi.fn() }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse }));

const { analyzeMaterial } = vi.hoisted(() => ({ analyzeMaterial: vi.fn() }));
vi.mock('@/lib/ai/course-profile/analyze-material', () => ({ analyzeMaterial }));

const { synthesizeCourseProfile } = vi.hoisted(() => ({ synthesizeCourseProfile: vi.fn() }));
vi.mock('@/lib/ai/course-profile/synthesize-course-profile', () => ({ synthesizeCourseProfile }));

const { cacheAnalysisFinding, insertProfileRun, upsertCourseProfile, getLatestRunForCourse } = vi.hoisted(
  () => ({
    cacheAnalysisFinding: vi.fn(),
    insertProfileRun: vi.fn(),
    upsertCourseProfile: vi.fn(),
    getLatestRunForCourse: vi.fn(),
  })
);
vi.mock('@/lib/db/course-profile-queries', () => ({
  cacheAnalysisFinding,
  insertProfileRun,
  upsertCourseProfile,
  getLatestRunForCourse,
}));

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

// ── Import under test ─────────────────────────────────────────────────────────

import { POST } from '@/app/api/courses/[code]/analyze-materials/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(slug = 'valid-slug-12345'): Request {
  return new Request(`http://test/api/courses/GC%204060/analyze-materials?slug=${slug}`, {
    method: 'POST',
  });
}

const ctx = { params: Promise.resolve({ code: 'GC 4060' }) };

const fakeCourse = {
  code: 'GC 4060',
  title: 'Color Science',
  level: 4,
  track: 'print',
  description: 'Advanced color.',
  learningObjectives: ['Understand color theory'],
  skillsRequired: ['Color management'],
};

const fakeMaterialOk = {
  id: 'mat-1',
  fileName: 'rubric.pdf',
  blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
  mimeType: 'application/pdf',
  extractedText: 'delta-E ≤ 2.0',
  extractionStatus: 'ok',
  analysisFinding: null,
  analysisModel: null,
  analysisCostUsdCents: null,
};

const fakeMaterialCached = {
  id: 'mat-2',
  fileName: 'worksheet.pdf',
  blobUrl: 'https://blob.vercel-storage.com/worksheet.pdf',
  mimeType: 'application/pdf',
  extractedText: 'some text',
  extractionStatus: 'ok',
  analysisFinding: { materialType: 'worksheet', competencies: [], skills: [], notes: '' },
  analysisModel: 'gpt-5.4-mini',
  analysisCostUsdCents: 5,
};

const fakeProfile = {
  summary: 'Develops press fluency.',
  learningObjectives: ['Operate a press'],
  skills: ['Color management'],
  competencies: [],
  catalogDivergence: { reinforced: [], additions: [], gaps: [] },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  isValidSlug.mockReturnValue(true);
  applyAnalyzeGuards.mockResolvedValue({ short: null, ipHash: 'abc123' });
  recordSpend.mockResolvedValue(undefined);
  getCourseByCode.mockResolvedValue(fakeCourse);
  getLatestRunForCourse.mockResolvedValue(null);
  insertProfileRun.mockResolvedValue('run-uuid-1');
  upsertCourseProfile.mockResolvedValue(undefined);
  cacheAnalysisFinding.mockResolvedValue(undefined);
  getProvider.mockReturnValue({ name: 'openai', model: 'gpt-5.4-mini' });
});

describe('POST /api/courses/[code]/analyze-materials', () => {
  it('401s when slug is invalid', async () => {
    isValidSlug.mockReturnValue(false);
    const res = await POST(makeReq('bad-slug'), ctx);
    expect(res.status).toBe(401);
  });

  it('404s when course does not exist', async () => {
    getCourseByCode.mockResolvedValue(null);
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(404);
  });

  it('returns the guard short-circuit response when rate-limited', async () => {
    const { NextResponse } = await import('next/server');
    applyAnalyzeGuards.mockResolvedValue({
      short: NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 }),
      ipHash: '',
    });
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(429);
  });

  it('400s when there are zero readable (ok) materials', async () => {
    listMaterialsByCourse.mockResolvedValue([]);
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no readable/i);
  });

  it('400s when all materials have non-ok extraction status', async () => {
    listMaterialsByCourse.mockResolvedValue([
      { ...fakeMaterialOk, extractionStatus: 'failed', analysisFinding: null },
    ]);
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(400);
  });

  it('skips materials that already have a cached analysisFinding', async () => {
    listMaterialsByCourse.mockResolvedValue([fakeMaterialCached]);
    synthesizeCourseProfile.mockResolvedValue({
      data: fakeProfile,
      telemetry: { costUsdCents: 15, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
    });
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(analyzeMaterial).not.toHaveBeenCalled();
  });

  it('runs per-file analysis for uncached materials and synthesizes', async () => {
    listMaterialsByCourse.mockResolvedValue([fakeMaterialOk]);
    analyzeMaterial.mockResolvedValue({
      data: { materialType: 'rubric', competencies: [], skills: [], notes: '' },
      telemetry: { costUsdCents: 7, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 50 },
    });
    synthesizeCourseProfile.mockResolvedValue({
      data: fakeProfile,
      telemetry: { costUsdCents: 15, cachedTokens: 0, uncachedPromptTokens: 200, completionTokens: 100 },
    });

    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(analyzeMaterial).toHaveBeenCalledTimes(1);
    expect(synthesizeCourseProfile).toHaveBeenCalledTimes(1);
    expect(cacheAnalysisFinding).toHaveBeenCalledWith(
      expect.objectContaining({ materialId: 'mat-1', costUsdCents: 7 })
    );
    expect(insertProfileRun).toHaveBeenCalledTimes(1);
    expect(upsertCourseProfile).toHaveBeenCalledTimes(1);
    expect(recordSpend).toHaveBeenCalledWith(22); // 7 + 15
    const callArg = analyzeMaterial.mock.calls[0]?.[0];
    expect(callArg?.documentBytes).toBeUndefined();
  });

  it('returns runId and totalCostUsdCents in the 200 body', async () => {
    listMaterialsByCourse.mockResolvedValue([fakeMaterialOk]);
    analyzeMaterial.mockResolvedValue({
      data: { materialType: 'rubric', competencies: [], skills: [], notes: '' },
      telemetry: { costUsdCents: 10, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
    });
    synthesizeCourseProfile.mockResolvedValue({
      data: fakeProfile,
      telemetry: { costUsdCents: 20, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
    });

    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runId).toBe('run-uuid-1');
    expect(json.totalCostUsdCents).toBe(30);
  });

  it('fetches blob bytes and passes documentBytes when provider is anthropic and material is PDF', async () => {
    getProvider.mockReturnValue({ name: 'anthropic', model: 'claude-sonnet-4-6' });

    const pdfMaterial = {
      ...fakeMaterialOk,
      mimeType: 'application/pdf',
      blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
    };
    listMaterialsByCourse.mockResolvedValue([pdfMaterial]);

    const fakePdfBytes = Buffer.from('%PDF-1.4');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => fakePdfBytes.buffer,
    } as unknown as Response);

    analyzeMaterial.mockResolvedValue({
      data: { materialType: 'rubric', competencies: [], skills: [], notes: '' },
      telemetry: { costUsdCents: 7, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 50 },
    });
    synthesizeCourseProfile.mockResolvedValue({
      data: fakeProfile,
      telemetry: { costUsdCents: 15, cachedTokens: 0, uncachedPromptTokens: 200, completionTokens: 100 },
    });

    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(200);

    const callArg = analyzeMaterial.mock.calls[0]?.[0];
    expect(Buffer.from(callArg.documentBytes).includes('%PDF-1.4')).toBe(true);
    expect(callArg?.documentMimeType).toBe('application/pdf');
  });

  it('500s when synthesis throws, keeping cached per-file findings intact', async () => {
    listMaterialsByCourse.mockResolvedValue([fakeMaterialOk]);
    analyzeMaterial.mockResolvedValue({
      data: { materialType: 'rubric', competencies: [], skills: [], notes: '' },
      telemetry: { costUsdCents: 7, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
    });
    synthesizeCourseProfile.mockRejectedValue(new Error('OpenAI error'));

    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(500);
    // Per-file findings were still cached before synthesis threw
    expect(cacheAnalysisFinding).toHaveBeenCalledTimes(1);
    expect(insertProfileRun).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });
});
