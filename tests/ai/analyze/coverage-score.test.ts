import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { scoreCoverage } from '@/lib/ai/analyze/coverage-score';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('SCORE SYSTEM PROMPT');
});

describe('scoreCoverage', () => {
  it('passes target context, course label, and KUD into the prompt and returns parsed scores', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: [{ subCompetencyId: 'press', kudLevel: 'do', confidence: 'high', reasoning: 'because the syllabus says so explicitly in the assignment' }],
      costUsdCents: 4, durationMs: 80, cachedTokens: 20, uncachedPromptTokens: 10, completionTokens: 15,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });
    const out = await scoreCoverage({
      targetContext: 'CTX',
      courseLabel: 'GC 4060',
      kud: { description: 'd', know: ['k1'], understand: ['u1'], do: ['d1'] },
    });
    expect(out.data).toHaveLength(1);
    expect(out.data[0]!.kudLevel).toBe('do');
    expect(out.telemetry.costUsdCents).toBe(4);
    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.systemPrompt).toBe('SCORE SYSTEM PROMPT');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('CTX');
    expect(arg.userMessage).toContain('k1');
  });
});
