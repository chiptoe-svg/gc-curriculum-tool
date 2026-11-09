// @vitest-environment node
/** A function whose role (or custom model) names the campus provider gets a CampusProvider, whatever AI_PROVIDER says. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => ({ default: class MockOpenAI { constructor(_opts: unknown) {} } }));
const resolved = vi.hoisted(() => ({ value: { model: 'gpt-6.1-sol', effort: 'low' as string | undefined, provider: 'openai' as 'openai' | 'campus' } }));
vi.mock('@/lib/ai/function-settings', () => ({ resolveForFunction: vi.fn(async () => resolved.value) }));

import { getProviderForFunction } from '@/lib/ai/provider';
import { campusReasoningParams } from '@/lib/ai/campus';
import { CAMPUS_MODELS, isCampusModel } from '@/lib/ai/models';

const sent = (p: unknown) => (p as { reasoningParams: Record<string, unknown> }).reasoningParams;

describe('role providers', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'k';
    process.env.CAMPUS_LLM_BASE_URL = 'http://campus';
    process.env.CAMPUS_LLM_API_KEY = 'k';
    delete process.env.CAMPUS_LLM_DEFAULT_MODEL;
    delete process.env.CAMPUS_LLM_REASONING;
  });

  it('a role with provider campus builds a CampusProvider for its model', async () => {
    resolved.value = { model: 'qwen3.8-27b-fp8', effort: 'off', provider: 'campus' };
    const p = await getProviderForFunction('parse-profile-fields');
    expect(p.name).toBe('campus');
    expect(p.model).toBe('qwen3.8-27b-fp8');
    expect(sent(p)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });

  it('an openai role is unchanged', async () => {
    resolved.value = { model: 'gpt-6.1-sol', effort: 'low', provider: 'openai' };
    const p = await getProviderForFunction('capture-scores');
    expect(p.name).toBe('openai');
    expect(p.model).toBe('gpt-6.1-sol');
  });

  it('unknown family sends no reasoning field', () => {
    expect(campusReasoningParams('gemma-4-31b', undefined)).toEqual({});
    expect(() => campusReasoningParams('gemma-4-31b', 'low')).toThrow();
  });

  it('names the pinned campus models', () => {
    expect([...CAMPUS_MODELS].sort()).toEqual(['deepseek-v4.1-flash-1017', 'glm-5.3', 'gptoss-120b', 'qwen3.8-27b-fp8']);
    expect(isCampusModel('qwen3.8-27b-fp8')).toBe(true);
    expect(isCampusModel('gpt-6.1-sol')).toBe(false);
  });
});
