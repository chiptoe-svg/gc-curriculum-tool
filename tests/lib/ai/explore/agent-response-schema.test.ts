import { describe, it, expect } from 'vitest';
import { ExploreAgentResponseSchema, ExploreAgentResponseJsonSchema } from '@/lib/ai/explore/agent-response-schema';

describe('ExploreAgentResponseSchema', () => {
  it('accepts a response with citations', () => {
    expect(ExploreAgentResponseSchema.safeParse({ response: 'here is my read', citations: [] }).success).toBe(true);
  });
  it('strict JSON schema: required === properties (OpenAI strict-mode)', () => {
    const s: any = ExploreAgentResponseJsonSchema;
    // top-level
    expect(new Set(s.required)).toEqual(new Set(Object.keys(s.properties)));
    // citation items object (recurse — a new citation field missing from items.required is a silent strict-mode hole)
    const items = s.properties.citations.items;
    expect(new Set(items.required)).toEqual(new Set(Object.keys(items.properties)));
  });
});
