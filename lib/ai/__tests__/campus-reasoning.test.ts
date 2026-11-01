import { describe, it, expect, vi, beforeEach } from 'vitest';
import { campusReasoningParams } from '../campus';

// Wire format per model family, from the 2026-11-01 probe against RCD
// (docs/superpowers/specs/2026-11-01-local-models-and-role-benchmark-design.md).
describe('campusReasoningParams', () => {
  it('sends nothing when no level is set (model default)', () => {
    expect(campusReasoningParams('glm-5.3', undefined)).toEqual({});
  });

  it('turns thinking off through the chat template for GLM, Qwen3.8 and DeepSeek', () => {
    for (const m of ['glm-5.3', 'qwen3.8-27b-fp8', 'deepseek-v4.1-flash-1017']) {
      expect(campusReasoningParams(m, 'off')).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    }
  });

  it('sends GLM, DeepSeek and gpt-oss levels as top-level reasoning_effort', () => {
    expect(campusReasoningParams('glm-5.3', 'medium')).toEqual({ reasoning_effort: 'medium' });
    expect(campusReasoningParams('deepseek-v4.1-flash-1017', 'high')).toEqual({ reasoning_effort: 'high' });
    expect(campusReasoningParams('gptoss-120b', 'low')).toEqual({ reasoning_effort: 'low' });
  });

  it('sends Qwen3.8 levels through the chat template with thinking on', () => {
    expect(campusReasoningParams('qwen3.8-27b-fp8', 'low')).toEqual({
      chat_template_kwargs: { enable_thinking: true, reasoning_effort: 'low' },
    });
  });

  it('refuses a level the model does not accept instead of guessing', () => {
    expect(() => campusReasoningParams('deepseek-v4.1-flash-1017', 'medium')).toThrow(/deepseek.*medium/i);
    expect(() => campusReasoningParams('gptoss-120b', 'off')).toThrow(/off/);
    expect(() => campusReasoningParams('qwen3.8-27b-fp8', 'high')).toThrow(/high/);
  });

  it('refuses a level on a moving alias or an unknown model', () => {
    expect(() => campusReasoningParams('tiger', 'low')).toThrow(/exact model/i);
    expect(() => campusReasoningParams('cub', 'off')).toThrow(/exact model/i);
    expect(() => campusReasoningParams('some-new-model', 'low')).toThrow(/some-new-model/);
  });
});

const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));

describe('CampusProvider sends the reasoning setting on every request', () => {
  beforeEach(() => {
    create.mockReset();
  });

  it('complete() includes it', async () => {
    const { CampusProvider } = await import('../campus');
    create.mockResolvedValue({ choices: [{ message: { content: '{"a":1}' } }], usage: {} });
    const p = new CampusProvider('qwen3.8-27b-fp8', 'http://x', 'k', { reasoning: 'low' });
    await p.complete({ systemPrompt: 's', userMessage: 'u', schemaName: 'n', jsonSchema: {}, validate: (r) => r });
    expect(create.mock.calls[0]![0].chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'low' });
  });

  it('completeWithTools() includes it on the tool step and the final step', async () => {
    const { CampusProvider } = await import('../campus');
    create
      .mockResolvedValueOnce({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: {} })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"a":1}' } }], usage: {} });
    const p = new CampusProvider('glm-5.3', 'http://x', 'k', { reasoning: 'off' });
    await p.completeWithTools({ systemPrompt: 's', messages: [{ role: 'user', content: 'u' }], tools: [], schemaName: 'n', jsonSchema: {}, validate: (r) => r });
    expect(create).toHaveBeenCalledTimes(2);
    for (const call of create.mock.calls) {
      expect(call[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    }
  });

  it('keeps the existing gpt-oss reasoningEffort option working', async () => {
    const { CampusProvider } = await import('../campus');
    create.mockResolvedValue({ choices: [{ message: { content: '{"a":1}' } }], usage: {} });
    const p = new CampusProvider('gptoss-120b', 'http://x', 'k', { reasoningEffort: 'low' });
    await p.complete({ systemPrompt: 's', userMessage: 'u', schemaName: 'n', jsonSchema: {}, validate: (r) => r });
    expect(create.mock.calls[0]![0].reasoning_effort).toBe('low');
  });
});
