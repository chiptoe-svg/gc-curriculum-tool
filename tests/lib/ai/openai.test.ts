import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '@/lib/ai/openai';
import { kudOutcomesSchema, kudOutcomesJsonSchema } from '@/lib/ai/schemas';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

beforeEach(() => {
  mockCreate.mockReset();
});

describe('OpenAIProvider', () => {
  it('parses a valid response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            description: 'A course',
            know: ['a'], understand: ['b'], do: ['c'],
          }),
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const provider = new OpenAIProvider('gpt-4o', 'sk-test');
    const result = await provider.complete({
      systemPrompt: 'sys',
      userMessage: 'usr',
      schemaName: 'kud',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    });
    expect(result.data.description).toBe('A course');
    expect(result.costUsdCents).toBeGreaterThan(0);
  });

  it('throws when response fails validation', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ description: '', know: [], understand: [], do: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });

    const provider = new OpenAIProvider('gpt-4o', 'sk-test');
    await expect(provider.complete({
      systemPrompt: 'sys',
      userMessage: 'usr',
      schemaName: 'kud',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    })).rejects.toThrow();
  });

  it('reports name and model', () => {
    const p = new OpenAIProvider('gpt-4o', 'sk-test');
    expect(p.name).toBe('openai');
    expect(p.model).toBe('gpt-4o');
  });
});
