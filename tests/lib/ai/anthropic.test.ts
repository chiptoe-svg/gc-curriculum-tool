import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  function MockAnthropic(_opts: unknown) {
    return { messages: { create: mockCreate } };
  }
  return { default: MockAnthropic };
});

import { AnthropicProvider } from '@/lib/ai/anthropic';
import { kudOutcomesSchema, kudOutcomesJsonSchema } from '@/lib/ai/schemas';

const validKud = { description: 'A course', know: ['a'], understand: ['b'], do: ['c'] };

const makeToolUseResponse = (input: unknown, inputTokens = 100, outputTokens = 50) => ({
  content: [{ type: 'tool_use', id: 'tu_1', name: 'kud', input }],
  usage: {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
});

beforeEach(() => {
  mockCreate.mockReset();
});

describe('AnthropicProvider', () => {
  it('reports name and model', () => {
    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    expect(p.name).toBe('anthropic');
    expect(p.model).toBe('claude-sonnet-4-6');
  });

  it('returns parsed data and telemetry from a tool_use response', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse(validKud));

    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    const result = await p.complete({
      systemPrompt: 'sys',
      userMessage: 'analyze this',
      schemaName: 'kud',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    });

    expect(result.data.description).toBe('A course');
    expect(result.completionTokens).toBe(50);
    expect(result.costUsdCents).toBeGreaterThan(0);
    expect(result.cachedTokens).toBe(0);
  });

  it('applies 10% rate to cache_read tokens', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'tu_2', name: 'kud', input: validKud }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 0,
      },
    });

    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    const result = await p.complete({
      systemPrompt: 'sys',
      userMessage: 'usr',
      schemaName: 'kud',
      jsonSchema: kudOutcomesJsonSchema,
      validate: (raw) => kudOutcomesSchema.parse(raw),
    });

    expect(result.cachedTokens).toBe(80);
    expect(result.uncachedPromptTokens).toBe(20); // 100 - 80
    expect(result.completionTokens).toBe(20);
    expect(result.costUsdCents).toBeGreaterThan(0);
  });

  it('throws when validation fails', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse({ description: '', know: [], understand: [], do: [] })
    );
    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    await expect(
      p.complete({
        systemPrompt: 'sys',
        userMessage: 'usr',
        schemaName: 'kud',
        jsonSchema: kudOutcomesJsonSchema,
        validate: (raw) => kudOutcomesSchema.parse(raw),
      })
    ).rejects.toThrow();
  });

  it('throws when response contains no tool_use block', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'sorry, cannot help' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    await expect(
      p.complete({
        systemPrompt: 'sys',
        userMessage: 'usr',
        schemaName: 'kud',
        jsonSchema: kudOutcomesJsonSchema,
        validate: (raw) => kudOutcomesSchema.parse(raw),
      })
    ).rejects.toThrow('No tool_use block');
  });

  it('transcribeDocument sends document block and returns text', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Transcribed content here.' }],
      usage: { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });

    const p = new AnthropicProvider('claude-sonnet-4-6', 'sk-ant-test');
    const result = await p.transcribeDocument({
      fileBytes: Buffer.from('%PDF-fake'),
      mimeType: 'application/pdf',
    });

    expect(result.text).toBe('Transcribed content here.');
    expect(result.truncated).toBe(false);
    expect(result.costUsdCents).toBeGreaterThan(0);

    const callArgs = mockCreate.mock.calls[0]![0];
    const userContent = callArgs.messages[0].content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent[0].type).toBe('document');
    expect(userContent[0].source.media_type).toBe('application/pdf');
  });
});
