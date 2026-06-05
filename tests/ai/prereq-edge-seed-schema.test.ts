import { describe, it, expect } from 'vitest';
import { SeededEdges, seededEdgesJsonSchema } from '@/lib/ai/analyze/prereq-edge-seed';

// ---------------------------------------------------------------------------
// Strict-mode walker
// Copied from tests/ai/position-capture-schema.test.ts (not exported there).
// Invariant: every key in `properties` must appear in `required`.
// ---------------------------------------------------------------------------
function assertStrictMode(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
    const propKeys = Object.keys(obj.properties as object);
    const required = (obj.required as string[] | undefined) ?? [];
    for (const key of propKeys) {
      expect(required, `property "${key}" must appear in required`).toContain(key);
    }
    for (const v of Object.values(obj.properties as object)) assertStrictMode(v);
  }
  if (obj.items) assertStrictMode(obj.items);
  if (obj.anyOf && Array.isArray(obj.anyOf)) for (const v of obj.anyOf) assertStrictMode(v);
}

describe('seededEdgesJsonSchema', () => {
  it('passes the strict-mode walker (every property listed in required)', () => {
    assertStrictMode(seededEdgesJsonSchema);
  });
});

describe('SeededEdges Zod schema', () => {
  it('accepts a valid edges array', () => {
    const valid = {
      edges: [
        {
          prereq_course_code: 'GC 1010',
          sub_competency_id: 'sc_color_theory',
          expected_k: 3,
          expected_u: 2,
          expected_d: null,
          confidence: 'high',
          rationale: 'Incoming expectation E1 requires K3 color theory recall; GC 1010 is the only listed prereq.',
        },
        {
          prereq_course_code: 'GC 2050',
          sub_competency_id: 'sc_prepress',
          expected_k: null,
          expected_u: null,
          expected_d: 2,
          confidence: 'medium',
          rationale: 'Prerequisites prose lists GC 2050; incoming expectation E3 requires D2 prepress workflow.',
        },
      ],
    };
    expect(() => SeededEdges.parse(valid)).not.toThrow();
  });

  it('accepts an empty edges array', () => {
    expect(() => SeededEdges.parse({ edges: [] })).not.toThrow();
  });

  it('rejects an edge missing prereq_course_code', () => {
    const invalid = {
      edges: [
        {
          sub_competency_id: 'sc_color_theory',
          expected_k: 3,
          expected_u: 2,
          expected_d: null,
          confidence: 'high',
          rationale: 'Some rationale.',
        },
      ],
    };
    expect(() => SeededEdges.parse(invalid)).toThrow();
  });

  it('rejects an edge with an out-of-range depth', () => {
    const invalid = {
      edges: [
        {
          prereq_course_code: 'GC 1010',
          sub_competency_id: 'sc_color_theory',
          expected_k: 6, // out of range
          expected_u: 2,
          expected_d: null,
          confidence: 'high',
          rationale: 'Test.',
        },
      ],
    };
    expect(() => SeededEdges.parse(invalid)).toThrow();
  });

  it('rejects an edge with an invalid confidence value', () => {
    const invalid = {
      edges: [
        {
          prereq_course_code: 'GC 1010',
          sub_competency_id: 'sc_color_theory',
          expected_k: 3,
          expected_u: 2,
          expected_d: null,
          confidence: 'very-high', // not in enum
          rationale: 'Test.',
        },
      ],
    };
    expect(() => SeededEdges.parse(invalid)).toThrow();
  });

  it('rejects an edge with an empty rationale', () => {
    const invalid = {
      edges: [
        {
          prereq_course_code: 'GC 1010',
          sub_competency_id: 'sc_color_theory',
          expected_k: 3,
          expected_u: 2,
          expected_d: null,
          confidence: 'high',
          rationale: '', // min(1) violated
        },
      ],
    };
    expect(() => SeededEdges.parse(invalid)).toThrow();
  });

  it('rejects missing edges property', () => {
    expect(() => SeededEdges.parse({})).toThrow();
  });
});
