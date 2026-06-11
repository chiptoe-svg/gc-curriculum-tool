import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getProvider,
  checkDailyCap,
  recordSpend,
  loadPrompt,
  buildSynthesisUserMessage,
  salaryDistributionForTarget,
  logPartnerEvent,
  targetSelectLimit,
  submissionsSelect,
  synthesisInsertReturning,
} = vi.hoisted(() => ({
  getProvider: vi.fn(),
  checkDailyCap: vi.fn(),
  recordSpend: vi.fn(),
  loadPrompt: vi.fn(),
  buildSynthesisUserMessage: vi.fn(),
  salaryDistributionForTarget: vi.fn(),
  logPartnerEvent: vi.fn(),
  targetSelectLimit: vi.fn(),
  submissionsSelect: vi.fn(),
  synthesisInsertReturning: vi.fn(),
}));

// orchestrator now resolves its model via getProviderForFunction('synthesize-target').
vi.mock('@/lib/ai/provider', () => ({ getProviderForFunction: getProvider }));

vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap, recordSpend }));

vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

vi.mock('@/lib/ai/synthesis/prompt-builder', () => ({ buildSynthesisUserMessage }));

vi.mock('@/lib/ai/synthesis/queries', () => ({
  salaryDistributionForTarget,
  // unused in orchestrator but mocked to satisfy module shape:
  countSubmittedForTarget: vi.fn(),
  countUniquePartnersForTarget: vi.fn(),
  sumPartnerWeightsForTarget: vi.fn(),
  nearbyUnmappedLabelsForTarget: vi.fn(),
}));

vi.mock('@/lib/partners/queries', () => ({ logPartnerEvent }));

// DB-layer mocks. The orchestrator does: load target, load submissions+partners,
// insert into synthesis_runs.
vi.mock('@/lib/db/client', () => ({
  db: {
    select: (..._args: unknown[]) => ({
      from: (_table: { _name?: string }) => {
        // route based on which table is being queried — using a marker
        return {
          where: () => ({
            limit: targetSelectLimit,
            orderBy: () => ({ then: undefined }),
          }),
          innerJoin: () => ({
            where: () => ({
              orderBy: () => submissionsSelect(),
            }),
          }),
        };
      },
    }),
    insert: () => ({ values: () => ({ returning: synthesisInsertReturning }) }),
  },
}));
vi.mock('@/lib/db/schema', () => ({
  careerTargets: { _name: 'careerTargets' },
  partnerSubmissions: { _name: 'partnerSubmissions' },
  partners: { _name: 'partners' },
  synthesisRuns: { _name: 'synthesisRuns' },
}));

import { synthesizeTarget } from '@/lib/ai/synthesis/orchestrator';

beforeEach(() => {
  vi.clearAllMocks();
  checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0 });
  recordSpend.mockResolvedValue(undefined);
  loadPrompt.mockResolvedValue('SYSTEM PROMPT');
  buildSynthesisUserMessage.mockReturnValue('USER MESSAGE');
  salaryDistributionForTarget.mockResolvedValue({ p25: 50000, p50: 60000, p75: 70000, n: 3 });
  logPartnerEvent.mockResolvedValue(undefined);
  synthesisInsertReturning.mockResolvedValue([{ id: 'run-1' }]);
});

function mockTarget(value: object | null) {
  targetSelectLimit.mockResolvedValue(value ? [value] : []);
}
function mockSubmissions(rows: object[]) {
  submissionsSelect.mockResolvedValue(rows);
}
function mockProvider(data: object, costUsdCents: number) {
  getProvider.mockResolvedValue({
    name: 'openai',
    model: 'gpt-5.4-mini',
    complete: vi.fn().mockResolvedValue({
      data, costUsdCents, durationMs: 1234, cachedTokens: 0, uncachedPromptTokens: 100, completionTokens: 50,
    }),
  });
}

describe('synthesizeTarget', () => {
  it('throws if daily cost cap exceeded', async () => {
    checkDailyCap.mockResolvedValueOnce({ ok: false, spentCents: 99999 });
    await expect(synthesizeTarget('production-operations')).rejects.toThrow(/daily cap/i);
  });

  it('throws if the career target does not exist', async () => {
    mockTarget(null);
    await expect(synthesizeTarget('does-not-exist')).rejects.toThrow(/not found/i);
  });

  it('throws if no submissions for the target', async () => {
    mockTarget({ id: 'production-operations', name: 'Production Operations', shortDefinition: 'x', knowDescriptors: [], understandDescriptors: [], doDescriptors: [] });
    mockSubmissions([]);
    await expect(synthesizeTarget('production-operations')).rejects.toThrow(/no submissions/i);
  });

  it('runs the full pipeline and persists the run with cost', async () => {
    mockTarget({ id: 'production-operations', name: 'Production Operations', shortDefinition: 'x', knowDescriptors: ['k1'], understandDescriptors: [], doDescriptors: [] });
    mockSubmissions([
      {
        submission: { partnerId: 'p1', positionTitle: 't', responsibilities: '', requiredSkills: [], niceToHaveSkills: [], interviewQuestions: [], additionalNotes: '', salaryRangeLow: null, salaryRangeHigh: null, salaryCurrency: 'USD' },
        partner: { firstName: 'A', lastName: 'X', company: 'Acme', weight: 1 },
      },
    ]);
    mockProvider({
      aggregatedJobTitles: [], responsibilityThemes: [], commonRequiredSkills: [], commonNiceToHaveSkills: [],
      interviewQuestionThemes: [], salaryDistribution: { p25: 50000, p50: 60000, p75: 70000, n: 3 },
      sampleQuotes: [], proposedKUDEdits: [],
    }, 42);
    const out = await synthesizeTarget('production-operations');
    expect(out.id).toBe('run-1');
    expect(recordSpend).toHaveBeenCalledWith(42);
    expect(logPartnerEvent).toHaveBeenCalledWith(
      null,
      'synthesis_run_completed',
      expect.objectContaining({
        targetId: 'production-operations',
        costUsdCents: 42,
        submissionCount: 1,
      }),
    );
  });

  it('excludes partners with weight=0 from the prompt input', async () => {
    mockTarget({ id: 'production-operations', name: 'X', shortDefinition: 'x', knowDescriptors: [], understandDescriptors: [], doDescriptors: [] });
    mockSubmissions([
      { submission: { partnerId: 'p1', positionTitle: 'a', responsibilities: '', requiredSkills: [], niceToHaveSkills: [], interviewQuestions: [], additionalNotes: '', salaryRangeLow: null, salaryRangeHigh: null, salaryCurrency: 'USD' }, partner: { firstName: 'A', lastName: 'X', company: 'Acme', weight: 1 } },
      { submission: { partnerId: 'p2', positionTitle: 'b', responsibilities: '', requiredSkills: [], niceToHaveSkills: [], interviewQuestions: [], additionalNotes: '', salaryRangeLow: null, salaryRangeHigh: null, salaryCurrency: 'USD' }, partner: { firstName: 'B', lastName: 'X', company: 'Zero', weight: 0 } },
    ]);
    mockProvider({
      aggregatedJobTitles: [], responsibilityThemes: [], commonRequiredSkills: [], commonNiceToHaveSkills: [],
      interviewQuestionThemes: [], salaryDistribution: { p25: 50000, p50: 60000, p75: 70000, n: 3 },
      sampleQuotes: [], proposedKUDEdits: [],
    }, 12);

    await synthesizeTarget('production-operations');
    const passed = buildSynthesisUserMessage.mock.calls[0]?.[0] as { submissions: { partnerId: string }[] } | undefined;
    expect(passed?.submissions.map(s => s.partnerId)).toEqual(['p1']);
  });
});
