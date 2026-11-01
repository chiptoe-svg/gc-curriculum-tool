// @vitest-environment node
/** An explicit override's reasoning level reaches a campus model; the role path stays unchanged. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => ({ default: class MockOpenAI { constructor(_opts: unknown) {} } }));
vi.mock('@/lib/ai/function-settings', () => ({
  resolveForFunction: vi.fn(async () => ({ model: 'gpt-6.1-sol', effort: 'low' })),
}));

import { getProviderForFunction } from '@/lib/ai/provider';

const sent = (p: unknown) => (p as { reasoningParams: Record<string, unknown> }).reasoningParams;

describe('getProviderForFunction on the campus provider', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'campus';
    process.env.CAMPUS_LLM_BASE_URL = 'http://campus';
    process.env.CAMPUS_LLM_API_KEY = 'k';
    delete process.env.CAMPUS_LLM_DEFAULT_MODEL;
  });

  it('sends an explicit override level to the named campus model', async () => {
    const p = await getProviderForFunction('program-score-coverage', { model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'off' });
    expect(p.model).toBe('deepseek-v4.1-flash-1017');
    expect(sent(p)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });

  it('does not send a role effort meant for OpenAI to a campus model', async () => {
    const p = await getProviderForFunction('program-score-coverage');
    expect(sent(p)).toEqual({});
  });
});
