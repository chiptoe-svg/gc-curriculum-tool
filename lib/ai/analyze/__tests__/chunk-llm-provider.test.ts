import { describe, it, expect, vi, beforeEach } from 'vitest';

const campusComplete = vi.fn();
const openaiComplete = vi.fn(async () => ({ data: { ok: true }, costUsdCents: 0, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 1, completionTokens: 1 }));

vi.mock('@/lib/ai/campus', () => ({
  CampusProvider: class { model = 'gptoss-120b'; complete = campusComplete; constructor() {} },
}));
vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: async () => ({ model: 'gpt-5.4-mini', complete: openaiComplete }),
}));

import { chunkLlmComplete } from '../chunk-llm-provider';

const args = { systemPrompt: 's', userMessage: 'u', schemaName: 'x', jsonSchema: {}, validate: (r: unknown) => r } as never;

describe('chunkLlmComplete noOpenAIFallback', () => {
  beforeEach(() => {
    process.env.CAMPUS_LLM_BASE_URL = 'http://campus/v1';
    process.env.CAMPUS_LLM_API_KEY = 'k';
    delete process.env.CHUNK_LLM_SKIP_CAMPUS;
    campusComplete.mockReset(); openaiComplete.mockClear();
    campusComplete.mockRejectedValue(new Error('campus down'));
  });

  it('falls back to OpenAI by default', async () => {
    await chunkLlmComplete('material-digest', args);
    expect(openaiComplete).toHaveBeenCalledOnce();
  });

  it('rethrows and never calls OpenAI when noOpenAIFallback is set', async () => {
    await expect(chunkLlmComplete('material-digest', args, { noOpenAIFallback: true })).rejects.toThrow('campus down');
    expect(openaiComplete).not.toHaveBeenCalled();
  });
});
