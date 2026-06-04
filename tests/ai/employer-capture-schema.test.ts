import { describe, it, expect } from 'vitest';
import { CareerCaptureProfile, careerCaptureProfileJsonSchema } from '@/lib/ai/employer-capture/schema';

describe('CareerCaptureProfile schema', () => {
  it('accepts a valid minimal profile', () => {
    const valid = {
      role_shape: {
        title_actual: 'Junior Brand Strategist',
        day_to_day_summary: 'Supports the brand strategy team on client research and concept development.',
        first_90_days: 'Shadow senior strategists; complete onboarding research project; present findings.',
        trajectory_12_24mo: 'Lead small-client engagements; develop concept frameworks independently.',
      },
      day_1_competencies: [{
        name: 'Audience research',
        description: 'Reads and summarizes target-audience interviews; synthesizes themes.',
        expected_on_day_1: { k_depth: 3, u_depth: 2, d_depth: 2, rationale: 'Needs to recognize patterns; not yet leading the methodology.' },
        notes: null,
      }],
      dealbreakers: [],
      hiring_signals: [],
      divergence_from_catalog: [],
      partner_summary: 'Looking for curious, evidence-driven juniors.',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => CareerCaptureProfile.parse(valid)).not.toThrow();
  });

  it('rejects missing role_shape', () => {
    const invalid = {
      day_1_competencies: [],
      dealbreakers: [],
      hiring_signals: [],
      divergence_from_catalog: [],
      partner_summary: 'x',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => CareerCaptureProfile.parse(invalid)).toThrow();
  });

  it('JSON schema has every property listed in required (strict-mode invariant)', () => {
    function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
        const propKeys = Object.keys(obj.properties as object);
        const required = (obj.required as string[] | undefined) ?? [];
        for (const key of propKeys) {
          expect(required, `property "${key}" must appear in required`).toContain(key);
        }
        for (const v of Object.values(obj.properties as object)) walk(v);
      }
      if (obj.items) walk(obj.items);
      if (obj.anyOf && Array.isArray(obj.anyOf)) for (const v of obj.anyOf) walk(v);
    }
    walk(careerCaptureProfileJsonSchema);
  });
});
