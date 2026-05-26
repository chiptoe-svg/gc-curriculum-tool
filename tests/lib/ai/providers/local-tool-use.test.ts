import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// v6 adaptation: structured output with tools uses generateText + Output.object, NOT generateObject.
const generateTextMock = vi.fn();
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText: (...args: unknown[]) => generateTextMock(...args) };
});
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    chatModel: vi.fn((model: string) => ({ modelId: model })),
  })),
}));
// Mock the raw OpenAI SDK so the constructor doesn't complain in test environment.
vi.mock('openai', () => ({
  default: class {
    constructor() {}
    chat = { completions: { create: vi.fn() } };
  },
}));

import { LocalProvider } from '@/lib/ai/local';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

const responseSchema = z.object({ finding: z.string(), question: z.string() });

function makeTools(): ToolDefinition[] {
  return [{
    name: 'fetch_material_section',
    description: 'Fetch a section of a material',
    inputSchema: z.object({ materialId: z.string(), query: z.string() }),
    execute: async () => ({ chunks: [] }),
  }];
}

describe('LocalProvider.completeWithTools', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    process.env.LOCAL_BASE_URL = 'http://localhost:8000/v1';
    process.env.LOCAL_API_KEY = 'godfrey';
  });

  it('returns a structured response from local omlx', async () => {
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

    const provider = new LocalProvider('Qwen3.6-35B-A3B-UD-MLX-4bit', 'http://localhost:8000/v1', 'godfrey');
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
});
