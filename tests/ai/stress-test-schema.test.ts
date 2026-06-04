import { describe, it, expect } from 'vitest';
import { StressTestResult, stressTestResultJsonSchema } from '@/lib/ai/stress-test/schema';

describe('StressTestResult schema', () => {
  it('accepts a minimal valid result', () => {
    const valid = {
      per_competency: [
        {
          competency_index: 0,
          confidence: 'high' as const,
          concerns: [],
          suggested_adjustments: null,
        },
      ],
      profile_level: {
        catalog_vs_evidence_concerns: [],
        consistency_concerns: [],
        coverage_concerns: [],
      },
      overall_assessment: 'sound' as const,
      summary: 'No issues found.',
    };
    expect(() => StressTestResult.parse(valid)).not.toThrow();
  });

  it('accepts a result with suggested adjustments', () => {
    const withAdjust = {
      per_competency: [
        {
          competency_index: 0,
          confidence: 'disputed' as const,
          concerns: ['K=4 cites only one chunk that shows recognition, not active use.'],
          suggested_adjustments: { k_depth: 2, u_depth: null, d_depth: null },
        },
      ],
      profile_level: {
        catalog_vs_evidence_concerns: [],
        consistency_concerns: [],
        coverage_concerns: [],
      },
      overall_assessment: 'mixed' as const,
      summary: 'One competency is materially miscalibrated; others sound.',
    };
    expect(() => StressTestResult.parse(withAdjust)).not.toThrow();
  });

  it('rejects an invalid confidence value', () => {
    const invalid = {
      per_competency: [
        {
          competency_index: 0,
          confidence: 'totally-fine',
          concerns: [],
          suggested_adjustments: null,
        },
      ],
      profile_level: {
        catalog_vs_evidence_concerns: [],
        consistency_concerns: [],
        coverage_concerns: [],
      },
      overall_assessment: 'sound',
      summary: 'OK.',
    };
    expect(() => StressTestResult.parse(invalid)).toThrow();
  });

  it('rejects a missing required field', () => {
    const missingSummary = {
      per_competency: [],
      profile_level: {
        catalog_vs_evidence_concerns: [],
        consistency_concerns: [],
        coverage_concerns: [],
      },
      overall_assessment: 'sound',
      // summary missing
    };
    expect(() => StressTestResult.parse(missingSummary)).toThrow();
  });

  it('JSON schema has every property listed in required (strict-mode invariant)', () => {
    // Recursively walk the JSON schema and assert that every object's
    // `properties` keys all appear in its `required` array. This is the
    // OpenAI strict-mode contract; violating it causes silent failures
    // on the openai provider that the campus/local providers tolerate.
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
    walk(stressTestResultJsonSchema);
  });
});
