import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// v6 adaptation: structured output with tools uses generateText + Output.object, NOT generateObject.
const generateTextMock = vi.fn();
const streamTextMock = vi.fn();
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateTextMock(...args),
    streamText: (...args: unknown[]) => streamTextMock(...args),
  };
});
vi.mock('@ai-sdk/openai', () => {
  // gpt-5.x and earlier use aiOpenai.chat(model) (Chat Completions). gpt-6* models use
  // aiOpenai.responses(model) (the stateless Responses API, store:false) because Chat
  // Completions rejects function tools on them. See lib/ai/openai.ts toolUseModelConfig.
  const openai = vi.fn((model: string) => ({ modelId: model }));
  (openai as unknown as { chat: (m: string) => unknown }).chat = (model: string) => ({ modelId: model, kind: 'chat' });
  (openai as unknown as { responses: (m: string) => unknown }).responses = (model: string) => ({ modelId: model, kind: 'responses' });
  return { openai };
});
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

/** A two-step generateText result: step 1 made a tool call and spent tokens;
 *  step 2 produced the final structured output. `usage`/`toolCalls` on the
 *  top-level result mirror the LAST step only; `totalUsage` sums both. */
function twoStepGenerateTextResult() {
  const step1ToolCall = { toolCallId: 'call_1', toolName: 'fetch_material_section', input: { materialId: 'm1', query: 'q' } };
  const step2ToolCall = { toolCallId: 'call_2', toolName: 'fetch_material_section', input: { materialId: 'm2', query: 'q2' } };
  return {
    output: { finding: 'f', question: 'q?' },
    usage: {
      inputTokens: 50,
      outputTokens: 20,
      inputTokenDetails: { cacheReadTokens: 0 },
    },
    totalUsage: {
      inputTokens: 150,
      outputTokens: 70,
      inputTokenDetails: { cacheReadTokens: 10 },
    },
    toolCalls: [step2ToolCall],
    steps: [
      { toolCalls: [step1ToolCall] },
      { toolCalls: [step2ToolCall] },
    ],
  };
}

describe('OpenAIProvider.completeWithTools', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    streamTextMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_REASONING_EFFORT;
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
      totalUsage: {
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: { cacheReadTokens: 0, noCacheTokens: 100, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
        totalTokens: 150,
      },
      toolCalls: [],
      steps: [{ toolCalls: [] }],
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
      totalUsage: {
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: { cacheReadTokens: 0, noCacheTokens: 100, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
        totalTokens: 150,
      },
      toolCalls: [],
      steps: [{ toolCalls: [] }],
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

  it('gpt-5.4 uses the Chat Completions model with no providerOptions change', async () => {
    generateTextMock.mockResolvedValue(twoStepGenerateTextResult());

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
    expect(args.model).toEqual({ modelId: 'gpt-5.4', kind: 'chat' });
    expect(args.providerOptions).toBeUndefined();
  });

  it('gpt-6.1-sol uses the Responses model with store:false, forceReasoning, and reasoningEffort "low"', async () => {
    generateTextMock.mockResolvedValue(twoStepGenerateTextResult());

    const provider = new OpenAIProvider('gpt-6.1-sol', 'test-key');
    await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    const args = generateTextMock.mock.calls[0]![0];
    expect(args.model).toEqual({ modelId: 'gpt-6.1-sol', kind: 'responses' });
    expect(args.providerOptions).toEqual({
      openai: {
        store: false,
        include: ['reasoning.encrypted_content'],
        forceReasoning: true,
        reasoningEffort: 'low',
      },
    });
  });

  it('computes cost from totalUsage (all steps), not the last-step-only usage', async () => {
    generateTextMock.mockResolvedValue(twoStepGenerateTextResult());

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
      // totalUsage: inputTokens 150, cacheReadTokens 10 -> uncached 140; outputTokens 70.
      expect(result.telemetry.uncachedPromptTokens).toBe(140);
      expect(result.telemetry.cachedTokens).toBe(10);
      expect(result.telemetry.completionTokens).toBe(70);
    }
  });

  it('builds toolCallsUsed from every step, not just the last one', async () => {
    generateTextMock.mockResolvedValue(twoStepGenerateTextResult());

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
      expect(result.toolCallsUsed.map(c => c.id)).toEqual(['call_1', 'call_2']);
    }
  });
});

describe('OpenAIProvider.streamWithTools', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    streamTextMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.OPENAI_REASONING_EFFORT;
  });

  function makeStreamResult(opts: {
    parts: Array<Record<string, unknown>>;
    totalUsage?: Record<string, unknown>;
    steps?: Array<{ toolCalls: Array<Record<string, unknown>> }>;
    output?: unknown;
  }) {
    return {
      fullStream: (async function* () {
        for (const part of opts.parts) yield part;
      })(),
      totalUsage: Promise.resolve(opts.totalUsage ?? { inputTokens: 0, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 0 } }),
      steps: Promise.resolve(opts.steps ?? []),
      output: Promise.resolve(opts.output ?? { finding: 'f', question: 'q?' }),
    };
  }

  it('gpt-5.4 uses the Chat Completions model with no providerOptions change', async () => {
    streamTextMock.mockReturnValue(makeStreamResult({ parts: [] }));

    const provider = new OpenAIProvider('gpt-5.4', 'test-key');
    const events = [];
    for await (const ev of provider.streamWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    })) {
      events.push(ev);
    }

    const args = streamTextMock.mock.calls[0]![0];
    expect(args.model).toEqual({ modelId: 'gpt-5.4', kind: 'chat' });
    expect(args.providerOptions).toBeUndefined();
  });

  it('gpt-6.1-sol uses the Responses model with store:false, forceReasoning, and reasoningEffort "low"', async () => {
    streamTextMock.mockReturnValue(makeStreamResult({ parts: [] }));

    const provider = new OpenAIProvider('gpt-6.1-sol', 'test-key');
    for await (const _ev of provider.streamWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    })) {
      // drain
    }

    const args = streamTextMock.mock.calls[0]![0];
    expect(args.model).toEqual({ modelId: 'gpt-6.1-sol', kind: 'responses' });
    expect(args.providerOptions).toEqual({
      openai: {
        store: false,
        include: ['reasoning.encrypted_content'],
        forceReasoning: true,
        reasoningEffort: 'low',
      },
    });
  });

  it('final event cost comes from totalUsage and toolCallsUsed from every step', async () => {
    streamTextMock.mockReturnValue(makeStreamResult({
      parts: [],
      totalUsage: { inputTokens: 150, outputTokens: 70, inputTokenDetails: { cacheReadTokens: 10 } },
      steps: [
        { toolCalls: [{ toolCallId: 'call_1', toolName: 'fetch_material_section', input: { materialId: 'm1', query: 'q' } }] },
        { toolCalls: [{ toolCallId: 'call_2', toolName: 'fetch_material_section', input: { materialId: 'm2', query: 'q2' } }] },
      ],
    }));

    const provider = new OpenAIProvider('gpt-5.4', 'test-key');
    const events = [];
    for await (const ev of provider.streamWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    })) {
      events.push(ev);
    }

    const final = events.find(e => e.kind === 'final');
    expect(final).toBeDefined();
    if (final && final.kind === 'final') {
      expect(final.telemetry.uncachedPromptTokens).toBe(140);
      expect(final.telemetry.cachedTokens).toBe(10);
      expect(final.telemetry.completionTokens).toBe(70);
      expect(final.toolCallsUsed.map(c => c.id)).toEqual(['call_1', 'call_2']);
    }
  });

  it('a mid-stream error part that is a plain object yields a readable message, not "[object Object]"', async () => {
    streamTextMock.mockReturnValue(makeStreamResult({
      parts: [{ type: 'error', error: { error: { message: 'upstream 400: use /v1/responses' } } }],
    }));

    const provider = new OpenAIProvider('gpt-6.1-sol', 'test-key');
    const events = [];
    for await (const ev of provider.streamWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    })) {
      events.push(ev);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'error', message: 'upstream 400: use /v1/responses' });
  });

  it('a mid-stream error part that is a real Error still yields its message', async () => {
    streamTextMock.mockReturnValue(makeStreamResult({
      parts: [{ type: 'error', error: new Error('boom') }],
    }));

    const provider = new OpenAIProvider('gpt-5.4', 'test-key');
    const events = [];
    for await (const ev of provider.streamWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    })) {
      events.push(ev);
    }

    expect(events).toEqual([{ kind: 'error', message: 'boom' }]);
  });
});
