// @vitest-environment node
/** A function's role effort reaches the provider; the env knob and an explicit override still win. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('openai', () => ({ default: class MockOpenAI { constructor(_opts: unknown) {} } }));
vi.mock('@/lib/ai/function-settings', () => ({
  resolveForFunction: vi.fn(async () => ({ model: 'gpt-6.1-sol', effort: 'medium' })),
}));

import { getProviderForFunction } from '@/lib/ai/provider';
import { effectiveReasoningEffort } from '@/lib/ai/openai';

const sentEffort = (p: unknown) => {
  const prov = p as { model: string; reasoningEffort?: string };
  return effectiveReasoningEffort(prov.model, prov.reasoningEffort);
};

describe('getProviderForFunction effort', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'x';
    delete process.env.OPENAI_REASONING_EFFORT;
  });
  afterEach(() => { delete process.env.OPENAI_REASONING_EFFORT; });

  it('sends the role effort', async () => {
    expect(sentEffort(await getProviderForFunction('wiki-update'))).toBe('medium');
  });

  it('keeps OPENAI_REASONING_EFFORT above the role effort', async () => {
    process.env.OPENAI_REASONING_EFFORT = 'high';
    expect(sentEffort(await getProviderForFunction('wiki-update'))).toBe('high');
  });

  it('lets an explicit override win', async () => {
    const p = await getProviderForFunction('wiki-update', { model: 'gpt-5.4', reasoningEffort: 'low' });
    expect(p.model).toBe('gpt-5.4');
    expect(sentEffort(p)).toBe('low');
  });
});
