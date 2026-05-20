import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { draftKUD } from '@/lib/ai/analyze/kud-draft';

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('DRAFT SYSTEM PROMPT');
  getProvider.mockReturnValue({
    name: 'openai',
    model: 'gpt-5.4-mini',
    complete: vi.fn().mockResolvedValue({
      data: { description: 'd', know: ['k1'], understand: ['u1'], do: ['d1'] },
      costUsdCents: 5, durationMs: 100, cachedTokens: 10, uncachedPromptTokens: 50, completionTokens: 30,
    }),
  });
});

describe('draftKUD', () => {
  it('returns parsed KUD outcomes plus telemetry', async () => {
    const out = await draftKUD({ targetContext: 'CTX', syllabusText: 'SYL' });
    expect(out.data.description).toBe('d');
    expect(out.telemetry.costUsdCents).toBe(5);
  });
  it('passes targetContext + syllabusText to the provider', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: { description: 'd', know: ['k'], understand: ['u'], do: ['x'] },
      costUsdCents: 1, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });
    await draftKUD({ targetContext: 'MY CTX', syllabusText: 'MY SYL' });
    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.systemPrompt).toBe('DRAFT SYSTEM PROMPT');
    expect(arg.userMessage).toContain('MY CTX');
    expect(arg.userMessage).toContain('MY SYL');
  });
});
