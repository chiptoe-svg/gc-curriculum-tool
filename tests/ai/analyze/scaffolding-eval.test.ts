import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { evaluateScaffolding } from '@/lib/ai/analyze/scaffolding-eval';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('SCAFFOLD SYSTEM PROMPT');
});

describe('evaluateScaffolding', () => {
  it('emits one entry per sub-competency referenced and returns telemetry', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: [{ subCompetencyId: 'press', quality: 'strong', reasoning: 'Course 4 picks up where Course 2 left off and adds depth.' }],
      costUsdCents: 6, durationMs: 90, cachedTokens: 30, uncachedPromptTokens: 5, completionTokens: 25,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });

    const out = await evaluateScaffolding({
      targetContext: 'CTX',
      courses: [
        { label: 'GC 1010', level: 1, coverage: [{ subCompetencyId: 'press', kudLevel: 'know', confidence: 'medium', reasoning: '...' }] },
        { label: 'GC 4060', level: 4, coverage: [{ subCompetencyId: 'press', kudLevel: 'do', confidence: 'high', reasoning: '...' }] },
      ],
    });
    expect(out.data[0]!.quality).toBe('strong');
    expect(out.telemetry.costUsdCents).toBe(6);
    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.userMessage).toContain('GC 1010');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('level 1');
    expect(arg.userMessage).toContain('level 4');
  });
});
