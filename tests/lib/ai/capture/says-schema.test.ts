import { describe, it, expect } from 'vitest';
import { captureCompetencySchema } from '@/lib/ai/capture/schema';
import { captureProfileJsonSchema } from '@/lib/ai/analyze/capture-scores';

const base = {
  statement: 'Students analyze packaging requirements',
  type: 'technical' as const,
  k_depth: 3, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz Q4', evidence_u: 'reflection memo', evidence_d: 'graded project',
  rationale: 'because the project shows it',
};

describe('captureCompetencySchema k_says/u_says/d_says', () => {
  it('accepts string sentences', () => {
    const r = captureCompetencySchema.safeParse({
      ...base, k_says: 'Students use the right terms.', u_says: 'They explain why.', d_says: 'They do it independently.',
    });
    expect(r.success && r.data.k_says).toBe('Students use the right terms.');
  });

  it('accepts null (foundational / pre-feature snapshots)', () => {
    const r = captureCompetencySchema.safeParse({
      ...base, type: 'foundational', k_depth: null, u_depth: null,
      k_says: null, u_says: null, d_says: 'Consistently attends to detail.',
    });
    expect(r.success && r.data.d_says).toBe('Consistently attends to detail.');
  });

  it('parses when the says fields are omitted (backward-compat)', () => {
    const r = captureCompetencySchema.safeParse(base);
    expect(r.success).toBe(true);
  });
});

describe('strict request schema — competency says fields', () => {
  const comp = (captureProfileJsonSchema as any).properties.competencies.items;

  it('lists k_says/u_says/d_says in required', () => {
    for (const f of ['k_says', 'u_says', 'd_says']) {
      expect(comp.required).toContain(f);
    }
  });

  it('declares them as nullable string in properties', () => {
    for (const f of ['k_says', 'u_says', 'd_says']) {
      expect(comp.properties[f]).toEqual({ type: ['string', 'null'] });
    }
  });

  it('keeps required and properties in sync (strict-mode invariant)', () => {
    expect(new Set(comp.required)).toEqual(new Set(Object.keys(comp.properties)));
  });
});
