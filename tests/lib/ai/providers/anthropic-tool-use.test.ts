import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// v6 adaptation: structured output with tools uses generateText + Output.object, NOT generateObject.
const generateTextMock = vi.fn();
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText: (...args: unknown[]) => generateTextMock(...args) };
});
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((model: string) => ({ modelId: model })),
}));
// Mock the raw Anthropic SDK so the constructor doesn't complain in test environment.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {}
    messages = { create: vi.fn() };
  },
}));

import { AnthropicProvider } from '@/lib/ai/anthropic';
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

describe('AnthropicProvider.completeWithTools', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
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

    const provider = new AnthropicProvider('claude-sonnet-4-6', 'test-key');
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

    const provider = new AnthropicProvider('claude-sonnet-4-6', 'test-key');
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
