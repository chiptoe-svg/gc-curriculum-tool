import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  applyAnalyzeGuards, buildTargetContext, draftKUD, scoreCoverage, evaluateScaffolding,
  persistAnalyzeRun, getTargetById, getProvider,
} = vi.hoisted(() => ({
  applyAnalyzeGuards: vi.fn(),
  buildTargetContext: vi.fn(),
  draftKUD: vi.fn(),
  scoreCoverage: vi.fn(),
  evaluateScaffolding: vi.fn(),
  persistAnalyzeRun: vi.fn(),
  getTargetById: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock('@/lib/ai/analyze/guards', () => ({ applyAnalyzeGuards }));
vi.mock('@/lib/ai/analyze/target-context', () => ({ buildTargetContext }));
vi.mock('@/lib/ai/analyze/kud-draft', () => ({ draftKUD }));
vi.mock('@/lib/ai/analyze/coverage-score', () => ({ scoreCoverage }));
vi.mock('@/lib/ai/analyze/scaffolding-eval', () => ({ evaluateScaffolding }));
vi.mock('@/lib/ai/analyze/persist', () => ({ persistAnalyzeRun }));
vi.mock('@/lib/db/career-targets-queries', () => ({ getTargetById }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));

import { POST } from '@/app/api/analyze/target-chain/route';

beforeEach(() => {
  vi.clearAllMocks();
  applyAnalyzeGuards.mockResolvedValue({ short: null, ipHash: 'hash' });
  buildTargetContext.mockReturnValue('CTX');
  getProvider.mockReturnValue({ name: 'openai', model: 'gpt' });
  persistAnalyzeRun.mockResolvedValue('run-1');
  getTargetById.mockResolvedValue({
    id: 'production-operations',
    name: 'Production Operations',
    shortDefinition: 'def',
    industryContexts: [], knowDescriptors: [], understandDescriptors: [], doDescriptors: [],
    defensibilityNote: 'note', socCode: null, subCompetencies: [],
  });
  draftKUD.mockImplementation(async () => ({
    data: { description: 'd', know: ['k'], understand: ['u'], do: ['x'] },
    telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
  }));
  scoreCoverage.mockImplementation(async () => ({
    data: [{ subCompetencyId: 'press', kudLevel: 'do', confidence: 'high', reasoning: 'because it is taught explicitly' }],
    telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
  }));
  evaluateScaffolding.mockResolvedValue({
    data: [{ subCompetencyId: 'press', quality: 'strong', reasoning: 'good progression' }],
    telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
  });
});

function makeReq(body: unknown) {
  return new Request('http://test/api/analyze/target-chain', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const minimalSyllabus = 'a'.repeat(60);  // satisfies min(50)

describe('POST /api/analyze/target-chain', () => {
  it('400s on invalid JSON', async () => {
    const res = await POST(new Request('http://t', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('400s on fewer than 2 courses', async () => {
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [{ courseLabel: 'GC 1010', syllabusText: minimalSyllabus }],
    }));
    expect(res.status).toBe(400);
  });

  it('400s on more than 16 courses', async () => {
    const courses = Array.from({ length: 17 }, (_, i) => ({ courseLabel: `GC 10${i}`, syllabusText: minimalSyllabus }));
    const res = await POST(makeReq({ careerTargetId: 'production-operations', courses }));
    expect(res.status).toBe(400);
  });

  it('400s on unknown careerTargetId', async () => {
    getTargetById.mockResolvedValueOnce(null);
    const res = await POST(makeReq({
      careerTargetId: 'does-not-exist',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
      ],
    }));
    expect(res.status).toBe(400);
  });

  it('429s when guard rate-limits', async () => {
    const { NextResponse } = await import('next/server');
    applyAnalyzeGuards.mockResolvedValueOnce({ short: NextResponse.json({ error: 'rate limit' }, { status: 429 }), ipHash: 'hash' });
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
      ],
    }));
    expect(res.status).toBe(429);
  });

  it('runs draftKUD per course, scoreCoverage per course, and one scaffolding call', async () => {
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
      ],
    }));
    expect(res.status).toBe(200);
    expect(draftKUD).toHaveBeenCalledTimes(2);
    expect(scoreCoverage).toHaveBeenCalledTimes(2);
    expect(evaluateScaffolding).toHaveBeenCalledTimes(1);
  });

  it('sorts courses by level ascending in the returned payload', async () => {
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
      ],
    }));
    const body = await res.json();
    expect(body.courses[0].courseLabel).toBe('GC 1010');
    expect(body.courses[1].courseLabel).toBe('GC 4060');
  });

  it('persists with analysisKind=target_chain and includes runId in response', async () => {
    const res = await POST(makeReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minimalSyllabus },
        { courseLabel: 'GC 4060', syllabusText: minimalSyllabus },
      ],
    }));
    expect(persistAnalyzeRun).toHaveBeenCalledWith(expect.objectContaining({ analysisKind: 'target_chain' }));
    const body = await res.json();
    expect(body.runId).toBe('run-1');
  });
});
