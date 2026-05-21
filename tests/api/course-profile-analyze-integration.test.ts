import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  applyAnalyzeGuards, buildTargetContext,
  draftCourseKUD, extractCoursePrereqs, scorePriorCoverage, analyzeCourseGaps, evaluateCourseScaffolding,
  draftKUD, scoreCoverage, evaluateScaffolding,
  persistAnalyzeRun, getTargetById, getProvider, resolveCourseContext,
} = vi.hoisted(() => ({
  applyAnalyzeGuards: vi.fn(),
  buildTargetContext: vi.fn(),
  draftCourseKUD: vi.fn(),
  extractCoursePrereqs: vi.fn(),
  scorePriorCoverage: vi.fn(),
  analyzeCourseGaps: vi.fn(),
  evaluateCourseScaffolding: vi.fn(),
  draftKUD: vi.fn(),
  scoreCoverage: vi.fn(),
  evaluateScaffolding: vi.fn(),
  persistAnalyzeRun: vi.fn(),
  getTargetById: vi.fn(),
  getProvider: vi.fn(),
  resolveCourseContext: vi.fn(),
}));

vi.mock('@/lib/ai/analyze/guards', () => ({ applyAnalyzeGuards }));
vi.mock('@/lib/ai/analyze/target-context', () => ({ buildTargetContext }));
vi.mock('@/lib/ai/analyze/kud-draft-course', () => ({ draftCourseKUD }));
vi.mock('@/lib/ai/analyze/extract-prereqs', () => ({ extractCoursePrereqs }));
vi.mock('@/lib/ai/analyze/score-prior-coverage', () => ({ scorePriorCoverage }));
vi.mock('@/lib/ai/analyze/analyze-course-gaps', () => ({ analyzeCourseGaps }));
vi.mock('@/lib/ai/analyze/evaluate-course-scaffolding', () => ({ evaluateCourseScaffolding }));
vi.mock('@/lib/ai/analyze/kud-draft', () => ({ draftKUD }));
vi.mock('@/lib/ai/analyze/coverage-score', () => ({ scoreCoverage }));
vi.mock('@/lib/ai/analyze/scaffolding-eval', () => ({ evaluateScaffolding }));
vi.mock('@/lib/ai/analyze/persist', () => ({ persistAnalyzeRun }));
vi.mock('@/lib/db/career-targets-queries', () => ({ getTargetById }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/analyze/resolve-course-context', () => ({ resolveCourseContext }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn().mockResolvedValue('PROMPT') }));

import { POST as analyzePost } from '@/app/api/analyze/route';
import { POST as chainPost } from '@/app/api/analyze/target-chain/route';

const fakeKud = {
  data: { description: 'd', know: ['k'], understand: ['u'], do: ['x'] },
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};
const fakePrereqs = {
  data: [],
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};
const fakeCoverage = {
  data: [],
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};
const fakeGaps = {
  data: [],
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};
const fakeScaffolding = {
  data: [],
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};

const fakeTarget = {
  id: 'production-operations',
  name: 'Production Operations',
  shortDefinition: 'def',
  industryContexts: [], knowDescriptors: [], understandDescriptors: [], doDescriptors: [],
  defensibilityNote: 'note', socCode: null, subCompetencies: [],
};

const minSyl = 'a'.repeat(60);

function makeAnalyzeReq(body: unknown) {
  return new Request('http://test/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

function makeChainReq(body: unknown) {
  return new Request('http://test/api/analyze/target-chain', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  applyAnalyzeGuards.mockResolvedValue({ short: null, ipHash: 'hash' });
  buildTargetContext.mockReturnValue('TARGET CTX');
  getProvider.mockReturnValue({ name: 'openai', model: 'gpt' });
  persistAnalyzeRun.mockResolvedValue('run-1');
  getTargetById.mockResolvedValue(fakeTarget);
  draftCourseKUD.mockResolvedValue(fakeKud);
  extractCoursePrereqs.mockResolvedValue(fakePrereqs);
  scorePriorCoverage.mockResolvedValue(fakeCoverage);
  analyzeCourseGaps.mockResolvedValue(fakeGaps);
  evaluateCourseScaffolding.mockResolvedValue(fakeScaffolding);
  draftKUD.mockResolvedValue(fakeKud);
  scoreCoverage.mockResolvedValue(fakeCoverage);
  evaluateScaffolding.mockResolvedValue(fakeScaffolding);
  resolveCourseContext.mockImplementation((_label: string, fallback: string) => Promise.resolve(fallback));
});

describe('/api/analyze — resolveCourseContext integration', () => {
  it('calls resolveCourseContext for the focal course and each prior course', async () => {
    const res = await analyzePost(makeAnalyzeReq({
      course: { courseLabel: 'GC 3460', syllabusText: minSyl },
      priorCoursework: [{ courseLabel: 'GC 1010', syllabusText: minSyl }],
    }));
    expect(res.status).toBe(200);
    expect(resolveCourseContext).toHaveBeenCalledTimes(2);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 3460', minSyl);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 1010', minSyl);
  });

  it('passes resolved context to draftCourseKUD (profile replaces raw syllabus)', async () => {
    resolveCourseContext.mockImplementation((label: string, fallback: string) => {
      if (label === 'GC 3460') return Promise.resolve('ENRICHED PROFILE TEXT');
      return Promise.resolve(fallback);
    });
    await analyzePost(makeAnalyzeReq({
      course: { courseLabel: 'GC 3460', syllabusText: minSyl },
      priorCoursework: [{ courseLabel: 'GC 1010', syllabusText: minSyl }],
    }));
    const kudCalls = draftCourseKUD.mock.calls as Array<[{ syllabusText: string }]>;
    const focalCall = kudCalls.find((c) => c[0].syllabusText === 'ENRICHED PROFILE TEXT');
    expect(focalCall).toBeDefined();
  });
});

describe('/api/analyze/target-chain — resolveCourseContext integration', () => {
  it('calls resolveCourseContext for every course in the chain', async () => {
    const res = await chainPost(makeChainReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minSyl },
        { courseLabel: 'GC 3460', syllabusText: minSyl },
        { courseLabel: 'GC 4060', syllabusText: minSyl },
      ],
    }));
    expect(res.status).toBe(200);
    expect(resolveCourseContext).toHaveBeenCalledTimes(3);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 1010', minSyl);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 3460', minSyl);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 4060', minSyl);
  });

  it('passes resolved text to draftKUD', async () => {
    resolveCourseContext.mockImplementation((label: string, fallback: string) => {
      if (label === 'GC 4060') return Promise.resolve('PROFILE FOR 4060');
      return Promise.resolve(fallback);
    });
    await chainPost(makeChainReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minSyl },
        { courseLabel: 'GC 4060', syllabusText: minSyl },
      ],
    }));
    const kudCalls = draftKUD.mock.calls as Array<[{ targetContext: string; syllabusText: string }]>;
    const enrichedCall = kudCalls.find((c) => c[0].syllabusText === 'PROFILE FOR 4060');
    expect(enrichedCall).toBeDefined();
  });
});
