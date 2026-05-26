import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// v6 adaptation: structured output with tools uses generateText + Output.object, NOT generateObject.
const generateTextMock = vi.fn();
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText: (...args: unknown[]) => generateTextMock(...args) };
});
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn((model: string) => ({ modelId: model })),
}));
// Mock the raw OpenAI SDK so the constructor doesn't complain in test environment.
vi.mock('openai', () => ({
  default: class {
    constructor() {}
    chat = { completions: { create: vi.fn() } };
  },
}));

import { OpenAIProvider } from '@/lib/ai/openai';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

const responseSchema = z.object({ finding: z.string(), question: z.string() });

function makeTools(): ToolDefinition[] {
  return [{
    name: 'fetch_material_section',
    description: 'Fetch a section of a material',
    inputSchema: z.object({ materialId: z.string(), query: z.string() }),
    execute: async () => ({ chunks: [{ text: 'sample', score: 0.9 }] }),
  }];
}

describe('OpenAIProvider.completeWithTools', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('returns a structured response when generateText resolves cleanly', async () => {
    // v6: result has `.output` (the structured value), `.usage` (LanguageModelUsage), `.toolCalls`
    generateTextMock.mockResolvedValue({
      output: { finding: 'f', question: 'q?' },
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: { cacheReadTokens: 0, noCacheTokens: 100, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
        totalTokens: 150,
      },
      toolCalls: [],
    });

    const provider = new OpenAIProvider('gpt-5.4', 'test-key');
    const result = await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.value).toEqual({ finding: 'f', question: 'q?' });
      expect(result.toolCallsUsed).toEqual([]);
      expect(generateTextMock).toHaveBeenCalledOnce();
    }
  });

  it('passes tool definitions into generateText', async () => {
    generateTextMock.mockResolvedValue({
      output: { finding: 'f', question: 'q?' },
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: { cacheReadTokens: 0, noCacheTokens: 100, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
        totalTokens: 150,
      },
      toolCalls: [],
    });

    const provider = new OpenAIProvider('gpt-5.4', 'test-key');
    await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    const args = generateTextMock.mock.calls[0]![0];
    expect(args.tools).toBeDefined();
    expect(args.tools.fetch_material_section).toBeDefined();
    expect(args.tools.fetch_material_section.description).toContain('Fetch a section');
  });
});
