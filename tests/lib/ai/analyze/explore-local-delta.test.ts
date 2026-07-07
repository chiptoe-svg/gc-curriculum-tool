import { describe, it, expect } from 'vitest';
import { localDeltaJsonSchema, localDeltaResultSchema } from '@/lib/ai/analyze/explore-local-delta';

describe('explore-local-delta schema', () => {
  it('strict request schema: every object property is required (OpenAI strict-mode invariant)', () => {
    const walk = (node: any) => {
      if (node?.type === 'object' && node.properties) {
        expect(new Set(node.required)).toEqual(new Set(Object.keys(node.properties)));
        Object.values(node.properties).forEach(walk);
      }
      if (Array.isArray(node?.type) && node.properties) {
        expect(new Set(node.required)).toEqual(new Set(Object.keys(node.properties)));
      }
      if (node?.type === 'array' && node.items) walk(node.items);
    };
    walk(localDeltaJsonSchema);
  });
  it('result parser accepts a representative payload', () => {
    const payload = {
      change: { prose: 'add trapping lab', activity: 'trapping lab', artifact: 'graded', competencies: ['prepress'], rubricCriteria: ['registration'], assumesIncoming: [{ label: 'color', subCompetencyId: null, k: 3, u: null, d: null }] },
      predictedDeltas: [{ competency: 'prepress', from: { k: 2, u: 2, d: 3 }, to: { k: 3, u: 2, d: 4 }, confidence: 'medium', rationale: 'r' }],
    };
    expect(localDeltaResultSchema.safeParse(payload).success).toBe(true);
  });
});
