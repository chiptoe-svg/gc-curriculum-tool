import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({ getProvider: vi.fn(), loadPrompt: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { suggestPrereqs } from '@/lib/ai/analyze/prereq-suggest';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('PREREQ PROMPT');
});

describe('suggestPrereqs', () => {
  it('returns parsed claims with telemetry', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: [{ subCompetencyId: 'press', expectedKudLevel: 'know', rationale: 'students need basic press literacy before the make-ready unit' }],
      costUsdCents: 3, durationMs: 60, cachedTokens: 5, uncachedPromptTokens: 5, completionTokens: 10,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });
    const out = await suggestPrereqs({
      targetContext: 'CTX',
      courseKud: { description: 'd', know: ['k'], understand: ['u'], do: ['x'] },
    });
    expect(out.data[0]!.subCompetencyId).toBe('press');
    expect(out.telemetry.costUsdCents).toBe(3);
  });
});
