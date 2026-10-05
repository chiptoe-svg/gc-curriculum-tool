import { describe, it, expect } from 'vitest';
import { modelGuideJsonSchema, ModelGuideSchema, ObjectiveGuideSchema } from '../schema';

// Invariant (OpenAI strict mode, CLAUDE.md): every key in `properties` is in
// `required`, and every object node forbids additional properties.
function assertStrictMode(node: unknown, path = '$'): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'object') {
    expect(obj.additionalProperties, `${path}: additionalProperties must be false`).toBe(false);
    const props = (obj.properties ?? {}) as Record<string, unknown>;
    const required = (obj.required as string[] | undefined) ?? [];
    for (const key of Object.keys(props)) {
      expect(required, `${path}.${key} must appear in required`).toContain(key);
      assertStrictMode(props[key], `${path}.${key}`);
    }
  }
  if (obj.items) assertStrictMode(obj.items, `${path}[]`);
}

describe('modelGuideJsonSchema', () => {
  it('passes the strict-mode walker', () => {
    assertStrictMode(modelGuideJsonSchema);
  });

  it('encodes the optional fields as nullable unions', () => {
    const objective = modelGuideJsonSchema.properties.objectives.items;
    expect(objective.properties.suggestion.type).toEqual(['string', 'null']);
    expect(objective.properties.evidence.items.properties.rubric_row.type).toEqual(['string', 'null']);
  });
});

describe('ModelGuideSchema / ObjectiveGuideSchema', () => {
  const valid = {
    intro: 'Intro.',
    objectives: [
      { objective: 'O', measure: 'partial', evidence: [{ assignment: 'A', rubric_row: null }], gather: 'G', suggestion: 'S' },
    ],
  };

  it('accepts a valid model guide', () => {
    expect(() => ModelGuideSchema.parse(valid)).not.toThrow();
  });

  it('rejects an unknown measure', () => {
    const bad = { ...valid, objectives: [{ ...valid.objectives[0], measure: 'mostly' }] };
    expect(() => ModelGuideSchema.parse(bad)).toThrow();
  });

  it('the stored guide adds a checklist', () => {
    expect(() => ObjectiveGuideSchema.parse({ ...valid, checklist: [{ assignment: 'A', rubric_row: null }] })).not.toThrow();
    expect(() => ObjectiveGuideSchema.parse(valid)).toThrow();
  });
});
