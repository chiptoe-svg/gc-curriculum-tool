import { describe, it, expect } from 'vitest';
import { PositionProfile, positionProfileJsonSchema } from '@/lib/ai/position-capture/schema';

describe('PositionProfile schema', () => {
  it('accepts a valid minimal profile', () => {
    const valid = {
      essence: {
        one_sentence: 'Brand strategist who supports senior team on client research.',
        what_this_role_is: 'Day-to-day research, concept dev, presentation support.',
        what_it_isnt: 'Not a designer; not a lead.',
      },
      qualifying_competencies: [{
        name: 'Audience research',
        description: 'Reads + summarizes target-audience interviews.',
        sub_competency_id: null,
        required_for_success: {
          k_depth: 3,
          u_depth: 2,
          d_depth: 2,
          rationale: 'Pattern recognition needed.',
          evidenced_by: ['Partner said pattern recognition across audience interviews is essential.'],
          confidence: 'medium',
        },
        notes: null,
      }],
      dealbreakers: [],
      hiring_signals: [],
      trajectory: { year_1: 'Shadowing.', year_2_to_3: 'Leading small engagements.' },
      partner_voice_summary: 'We want curious, evidence-driven juniors.',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => PositionProfile.parse(valid)).not.toThrow();
  });

  it('rejects missing essence', () => {
    const invalid = {
      qualifying_competencies: [],
      dealbreakers: [],
      hiring_signals: [],
      trajectory: { year_1: 'x', year_2_to_3: 'y' },
      partner_voice_summary: 'x',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => PositionProfile.parse(invalid)).toThrow();
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
    walk(positionProfileJsonSchema);
  });

  it('rejects an above-floor depth with no evidenced_by', () => {
    const profileWithBadCompetency = {
      essence: {
        one_sentence: 'Brand strategist who supports senior team on client research.',
        what_this_role_is: 'Day-to-day research, concept dev, presentation support.',
        what_it_isnt: 'Not a designer; not a lead.',
      },
      qualifying_competencies: [{
        name: 'Audience research',
        description: 'Reads + summarizes target-audience interviews.',
        sub_competency_id: null,
        required_for_success: {
          k_depth: 0,
          u_depth: 0,
          d_depth: 3,
          rationale: 'Must be able to produce research decks independently.',
          evidenced_by: null,
          confidence: 'medium',
        },
        notes: null,
      }],
      dealbreakers: [],
      hiring_signals: [],
      trajectory: { year_1: 'Shadowing.', year_2_to_3: 'Leading small engagements.' },
      partner_voice_summary: 'We want curious, evidence-driven juniors.',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => PositionProfile.parse(profileWithBadCompetency)).toThrow();
  });
});
