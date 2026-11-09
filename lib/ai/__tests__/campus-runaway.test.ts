// @vitest-environment node
/** Part 2 Task 3: a campus call that runs away (token cap or time limit) is retried once with thinking off, then fails. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({ default: class MockOpenAI { chat = { completions: { create } }; constructor(_o: unknown) {} } }));

const ok = { choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }], usage: {} };
const cut = { choices: [{ finish_reason: 'length', message: { content: '{"a":' } }], usage: {} };
const args = { systemPrompt: 's', userMessage: 'u', schemaName: 'n', jsonSchema: {}, validate: (r: unknown) => r };

describe('campus runaway guard', () => {
  beforeEach(() => { create.mockReset(); });

  it('a response that stops at the length limit is retried once with thinking off', async () => {
    const { CampusProvider } = await import('../campus');
    create.mockResolvedValueOnce(cut).mockResolvedValueOnce(ok);
    const p = new CampusProvider('qwen3.8-27b-fp8', 'http://x', 'k', { reasoning: 'medium' });
    await expect(p.complete(args)).resolves.toMatchObject({ data: { a: 1 } });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].max_tokens).toBe(8000);
    expect(create.mock.calls[1]![0].chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('a second runaway throws CampusRunawayError', async () => {
    const { CampusProvider, CampusRunawayError } = await import('../campus');
    create.mockResolvedValue(cut);
    const p = new CampusProvider('qwen3.8-27b-fp8', 'http://x', 'k', { reasoning: 'off' });
    await expect(p.complete(args)).rejects.toBeInstanceOf(CampusRunawayError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('a timeout aborts and retries once', async () => {
    const { CampusProvider } = await import('../campus');
    create.mockRejectedValueOnce(Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })).mockResolvedValueOnce(ok);
    const p = new CampusProvider('deepseek-v4.1-flash-1017', 'http://x', 'k', { reasoning: 'low' });
    await expect(p.complete(args)).resolves.toMatchObject({ data: { a: 1 } });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![1]).toMatchObject({ timeout: 90_000 });
  });
});
