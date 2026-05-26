import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FakeProvider } from '@/lib/ai/fake-provider';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

function makeTools(): ToolDefinition[] {
  return [
    {
      name: 'fetch_material_section',
      description: 'Fetch a section of a material',
      inputSchema: z.object({ materialId: z.string(), query: z.string() }),
      execute: async (args) => ({ chunks: [{ chunkId: 'c-1', text: 'sample content', score: 0.9 }] }),
    },
  ];
}

const responseSchema = z.object({ finding: z.string(), question: z.string() });

describe('FakeProvider.completeWithTools', () => {
  it('returns a scripted final response immediately when no tool calls are scripted', async () => {
    const provider = new FakeProvider({
      toolUseScript: [{
        kind: 'response',
        value: { finding: 'test finding', question: 'test question?' },
      }],
    });

    const result = await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: makeTools(),
      schemaName: 'TestResponse',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.value).toEqual({ finding: 'test finding', question: 'test question?' });
      expect(result.toolCallsUsed).toEqual([]);
    }
  });

  it('executes scripted tool calls before returning the final response', async () => {
    const provider = new FakeProvider({
      toolUseScript: [
        {
          kind: 'tool_calls',
          calls: [{ id: 'tc-1', toolName: 'fetch_material_section', args: { materialId: 'm-1', query: 'rubric' } }],
        },
        {
          kind: 'response',
          value: { finding: 'after tool', question: 'follow-up?' },
        },
      ],
    });

    const result = await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: makeTools(),
      schemaName: 'TestResponse',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.toolCallsUsed.length).toBe(1);
      expect(result.toolCallsUsed[0]!.toolName).toBe('fetch_material_section');
    }
  });

  it('throws when scripted tool call references an undefined tool', async () => {
    const provider = new FakeProvider({
      toolUseScript: [{
        kind: 'tool_calls',
        calls: [{ id: 'tc-1', toolName: 'nonexistent_tool', args: {} }],
      }],
    });

    await expect(provider.completeWithTools({
      systemPrompt: 'system',
      messages: [],
      tools: makeTools(),
      schemaName: 'TestResponse',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    })).rejects.toThrow(/nonexistent_tool/);
  });

  it('respects maxToolCalls budget', async () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({
      kind: 'tool_calls' as const,
      calls: [{ id: `tc-${i}`, toolName: 'fetch_material_section', args: { materialId: 'm', query: 'q' } }],
    }));
    const provider = new FakeProvider({
      toolUseScript: [...calls, { kind: 'response', value: { finding: 'f', question: 'q' } }],
    });

    await expect(provider.completeWithTools({
      systemPrompt: 'system',
      messages: [],
      tools: makeTools(),
      schemaName: 'TestResponse',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
      maxToolCalls: 2,
    })).rejects.toThrow(/budget/i);
  });
});
