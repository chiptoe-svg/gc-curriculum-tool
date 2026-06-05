import { describe, it, expect } from 'vitest';
import { IntendedSkills, intendedSkillsJsonSchema } from '@/lib/ai/analyze/intended-skills-extract';

// ---------------------------------------------------------------------------
// Strict-mode walker
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

describe('intendedSkillsJsonSchema', () => {
  it('passes the strict-mode walker (every property listed in required)', () => {
    assertStrictMode(intendedSkillsJsonSchema);
  });
});

describe('IntendedSkills Zod schema', () => {
  it('accepts a valid items array', () => {
    const valid = {
      items: [
        {
          sub_competency_id: 'sc_color_theory',
          intended_k: 3,
          intended_u: 2,
          intended_d: null,
          confidence: 'high',
          rationale: 'Learning objective 1 states students will recall and apply color theory terminology, directly mapping to K3.',
        },
        {
          sub_competency_id: 'sc_prepress_workflow',
          intended_k: null,
          intended_u: null,
          intended_d: 2,
          confidence: 'medium',
          rationale: 'Major project 2 requires students to prepare print-ready files independently, implying D2 prepress workflow.',
        },
      ],
    };
    expect(() => IntendedSkills.parse(valid)).not.toThrow();
  });

  it('accepts an empty items array', () => {
    expect(() => IntendedSkills.parse({ items: [] })).not.toThrow();
  });

  it('rejects an item missing sub_competency_id', () => {
    const invalid = {
      items: [
        {
          intended_k: 3,
          intended_u: 2,
          intended_d: null,
          confidence: 'high',
          rationale: 'Some rationale.',
        },
      ],
    };
    expect(() => IntendedSkills.parse(invalid)).toThrow();
  });

  it('rejects an item with an out-of-range depth', () => {
    const invalid = {
      items: [
        {
          sub_competency_id: 'sc_color_theory',
          intended_k: 6, // out of range
          intended_u: 2,
          intended_d: null,
          confidence: 'high',
          rationale: 'Test.',
        },
      ],
    };
    expect(() => IntendedSkills.parse(invalid)).toThrow();
  });

  it('rejects an item with an invalid confidence value', () => {
    const invalid = {
      items: [
        {
          sub_competency_id: 'sc_color_theory',
          intended_k: 3,
          intended_u: 2,
          intended_d: null,
          confidence: 'very-high', // not in enum
          rationale: 'Test.',
        },
      ],
    };
    expect(() => IntendedSkills.parse(invalid)).toThrow();
  });

  it('rejects an item with an empty rationale', () => {
    const invalid = {
      items: [
        {
          sub_competency_id: 'sc_color_theory',
          intended_k: 3,
          intended_u: 2,
          intended_d: null,
          confidence: 'high',
          rationale: '', // min(1) violated
        },
      ],
    };
    expect(() => IntendedSkills.parse(invalid)).toThrow();
  });

  it('rejects missing items property', () => {
    expect(() => IntendedSkills.parse({})).toThrow();
  });
});
