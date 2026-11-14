import { describe, it, expect } from 'vitest';
import { whatIfEstimateSchema, WHAT_IF_ESTIMATE_JSON_SCHEMA } from '@/lib/what-if/estimate-schema';

type Node = Record<string, unknown>;

function walk(node: unknown, path: string, visit: (n: Node, path: string) => void): void {
  if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`, visit)); return; }
  if (!node || typeof node !== 'object') return;
  visit(node as Node, path);
  for (const [k, v] of Object.entries(node as Node)) walk(v, `${path}.${k}`, visit);
}

const sample = {
  changeItems: [{ kind: 'added', description: 'A color lab' }],
  movedRatings: [{ statement: 's', after: { k: 3, u: null, d: 2 }, confidence: 'low', reason: 'r' }],
  newCompetencies: [{ statement: 'n', type: 'technical', predicted: { k: 1, u: 1, d: 1 }, subCompetencyId: null, confidence: 'high', reason: 'r' }],
  incomingChanges: [{ kind: 'new', statement: 'i', expected: null, subCompetencyId: 'x' }],
};

describe('what-if estimate schema', () => {
  it('every object node is strict: no extra keys, every property required', () => {
    let objects = 0;
    walk(WHAT_IF_ESTIMATE_JSON_SCHEMA, '$', (n, path) => {
      if (n.type !== 'object') return;
      objects++;
      expect(n.additionalProperties, path).toBe(false);
      expect([...(n.required as string[])].sort(), path).toEqual(Object.keys(n.properties as Node).sort());
    });
    expect(objects).toBeGreaterThan(4);
  });

  it('depths are integers 0 to 5 or null', () => {
    const depths: Node[] = [];
    walk(WHAT_IF_ESTIMATE_JSON_SCHEMA, '$', (n, path) => {
      if (/\.properties\.(k|u|d)$/.test(path)) depths.push(n);
    });
    expect(depths.length).toBeGreaterThanOrEqual(9);
    for (const d of depths) expect(d).toMatchObject({ type: ['integer', 'null'], minimum: 0, maximum: 5 });
  });

  it('parses a sample object', () => {
    expect(whatIfEstimateSchema.parse(sample)).toEqual(sample);
  });

  it('rejects a depth of 6', () => {
    const bad = { ...sample, movedRatings: [{ ...sample.movedRatings[0], after: { k: 6, u: 0, d: 0 } }] };
    expect(() => whatIfEstimateSchema.parse(bad)).toThrow();
  });
});
