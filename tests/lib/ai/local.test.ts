import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => {
  function MockOpenAI(_opts: unknown) {
    return { chat: { completions: { create: mockCreate } } };
  }
  return { default: MockOpenAI };
});

import { LocalProvider } from '@/lib/ai/local';
import { kudOutcomesSchema, kudOutcomesJsonSchema } from '@/lib/ai/schemas';

const validKud = { description: 'A course', know: ['a'], understand: ['b'], do: ['c'] };

const makeResponse = (content: string, promptTokens = 100, completionTokens = 50) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
});

beforeEach(() => {
  mockCreate.mockReset();
});

describe('LocalProvider', () => {
  it('reports name and model', () => {
    const p = new LocalProvider('qwen3-35b', 'http://localhost:8000/v1');
    expect(p.name).toBe('local');
    expect(p.model).toBe('qwen3-35b');
  });

  it('returns parsed data and zero cost telemetry', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse(JSON.stringify(validKud)));
    const p = new LocalProvider('qwen3-35b', 'http://localhost:8000/v1');
    const result = await p.complete({
      systemPrompt: 'You are a helpful assistant.',
      userMessage: 'Generate KUDs.',
      schemaName: 'kud_outcomes',
      jsonSchema: kudOutcomesJsonSchema,
      validate: kudOutcomesSchema.parse,
    });
    expect(result.data).toEqual(validKud);
    expect(result.costUsdCents).toBe(0);
    expect(result.cachedTokens).toBe(0);
    expect(result.uncachedPromptTokens).toBe(100);
    expect(result.completionTokens).toBe(50);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('appends schema to system prompt', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse(JSON.stringify(validKud)));
    const p = new LocalProvider('qwen3-35b', 'http://localhost:8000/v1');
    await p.complete({
      systemPrompt: 'Base prompt.',
      userMessage: 'Go.',
      schemaName: 'kud_outcomes',
      jsonSchema: kudOutcomesJsonSchema,
      validate: kudOutcomesSchema.parse,
    });
    const call = mockCreate.mock.calls[0]?.[0];
    const system = call?.messages?.[0]?.content as string;
    expect(system).toContain('Base prompt.');
    expect(system).toContain('valid JSON');
    expect(system).toContain('"description"');
  });

  it('uses json_object response format', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse(JSON.stringify(validKud)));
    const p = new LocalProvider('qwen3-35b', 'http://localhost:8000/v1');
    await p.complete({
      systemPrompt: 'S',
      userMessage: 'U',
      schemaName: 'k',
      jsonSchema: kudOutcomesJsonSchema,
      validate: kudOutcomesSchema.parse,
    });
    const call = mockCreate.mock.calls[0]?.[0];
    expect(call?.response_format).toEqual({ type: 'json_object' });
  });

  it('throws on non-JSON response', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse('Sorry, I cannot do that.'));
    const p = new LocalProvider('qwen3-35b', 'http://localhost:8000/v1');
    await expect(
      p.complete({
        systemPrompt: 'S',
        userMessage: 'U',
        schemaName: 'k',
        jsonSchema: kudOutcomesJsonSchema,
        validate: kudOutcomesSchema.parse,
      }),
    ).rejects.toThrow('Local model returned non-JSON');
  });

  it('throws from transcribeDocument (handled by caller)', async () => {
    const p = new LocalProvider('qwen3-35b', 'http://localhost:8000/v1');
    await expect(
      p.transcribeDocument({ fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf' }),
    ).rejects.toThrow('Local provider does not support document vision transcription');
  });
});
