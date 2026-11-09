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
    delete process.env.CAMPUS_LLM_REASONING;
  });

  it('sends an explicit override level to the named campus model', async () => {
    const p = await getProviderForFunction('program-score-coverage', { courseCode: 'GC 1010' }, { model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'off' });
    expect(p.model).toBe('deepseek-v4.1-flash-1017');
    expect(sent(p)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });

  it('does not send a role effort meant for OpenAI to a campus model', async () => {
    const p = await getProviderForFunction('program-score-coverage', { courseCode: 'GC 1010' });
    expect(sent(p)).toEqual({});
  });

  it('applies CAMPUS_LLM_REASONING to role calls on the pinned campus model (benchmarks)', async () => {
    process.env.CAMPUS_LLM_DEFAULT_MODEL = 'deepseek-v4.1-flash-1017';
    process.env.CAMPUS_LLM_REASONING = 'off';
    const p = await getProviderForFunction('material-classify', { courseCode: 'GC 1010' });
    expect(p.model).toBe('deepseek-v4.1-flash-1017');
    expect(sent(p)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });
});
