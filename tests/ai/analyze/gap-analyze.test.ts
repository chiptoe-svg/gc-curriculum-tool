import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({ getProvider: vi.fn(), loadPrompt: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { analyzeGaps } from '@/lib/ai/analyze/gap-analyze';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('GAP PROMPT');
});

describe('analyzeGaps', () => {
  it('returns parsed gaps with telemetry', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: [{
        subCompetencyId: 'press',
        expectedKudLevel: 'know',
        status: 'met',
        priorCourseworkEvidence: 'GC 1010 explicitly addresses press parts in Week 4 lab.',
        reasoning: 'The prior course meets the expected level of press literacy required by the focal course.',
      }],
      costUsdCents: 5, durationMs: 80, cachedTokens: 10, uncachedPromptTokens: 5, completionTokens: 15,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });
    const out = await analyzeGaps({
      targetContext: 'CTX',
      prereqs: [{ subCompetencyId: 'press', expectedKudLevel: 'know', rationale: 'rationale' }],
      priorCoursework: [
        { courseLabel: 'GC 1010', coverage: [{ subCompetencyId: 'press', kudLevel: 'know', confidence: 'high', reasoning: 'taught explicitly' }] },
      ],
    });
    expect(out.data[0]!.status).toBe('met');
    expect(out.telemetry.costUsdCents).toBe(5);
  });
});
