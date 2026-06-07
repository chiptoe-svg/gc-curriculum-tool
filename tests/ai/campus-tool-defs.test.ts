import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toOpenAiToolDefs } from '@/lib/ai/campus';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

/**
 * Audit F2: the campus provider must convert each tool's Zod schema to a real
 * JSON Schema for OpenAI `function.parameters`. A raw cast shipped Zod's
 * internal serialization ({ def, type }) with no `properties`, so the model
 * could not see argument names/types.
 */
describe('toOpenAiToolDefs', () => {
  const tool: ToolDefinition = {
    name: 'search_materials',
    description: 'Search course materials',
    inputSchema: z.object({
      courseCode: z.string(),
      query: z.string(),
      k: z.number().int().optional(),
    }),
    execute: async () => null,
  };

  it('produces JSON Schema parameters with properties (not Zod internals)', () => {
    const [def] = toOpenAiToolDefs([tool]);
    if (!def || def.type !== 'function') throw new Error('expected a function tool');
    const params = def.function.parameters as Record<string, unknown>;
    expect(params).toBeDefined();
    expect(params.type).toBe('object');
    expect(params.properties).toBeDefined();
    expect(Object.keys(params.properties as object)).toEqual(
      expect.arrayContaining(['courseCode', 'query', 'k']),
    );
    // The bug signature: Zod v4 internal serialization carries `def`.
    expect(params.def).toBeUndefined();
  });

  it('carries the tool name and rendered description', () => {
    const [def] = toOpenAiToolDefs([tool]);
    if (!def || def.type !== 'function') throw new Error('expected a function tool');
    expect(def.function.name).toBe('search_materials');
    expect(def.function.description).toContain('Search course materials');
  });
});
