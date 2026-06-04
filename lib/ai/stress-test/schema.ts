import { z } from 'zod';

/**
 * Output of the capture-stress-test reviewer agent. Ephemeral — held
 * in client state, not persisted to the working draft. The reviewer
 * agent emits one annotation per competency in the same order as the
 * profile's `competencies[]` array, plus profile-level concerns and
 * an overall assessment.
 *
 * See lib/ai/prompts/capture-stress-test.md for the persona + the
 * decision rules the reviewer uses to set confidence + suggest
 * adjustments.
 */

export const StressTestConfidence = z.enum(['high', 'medium', 'low', 'disputed']);
export type StressTestConfidenceType = z.infer<typeof StressTestConfidence>;

export const StressTestOverall = z.enum(['sound', 'mixed', 'questionable']);
export type StressTestOverallType = z.infer<typeof StressTestOverall>;

/**
 * Per-competency annotation. competency_index refers to the position
 * in profile.competencies[]; suggested_adjustments is only present
 * when the reviewer thinks scores are materially wrong (not for soft
 * judgement-call differences).
 */
export const StressTestCompetencyAnnotation = z.object({
  competency_index: z.number().int().min(0),
  confidence: StressTestConfidence,
  concerns: z.array(z.string().min(1).max(500)),
  suggested_adjustments: z.object({
    k_depth: z.number().int().min(0).max(5).nullable(),
    u_depth: z.number().int().min(0).max(5).nullable(),
    d_depth: z.number().int().min(0).max(5).nullable(),
  }).nullable(),
});
export type StressTestCompetencyAnnotationType = z.infer<typeof StressTestCompetencyAnnotation>;

/**
 * Profile-level concerns — three buckets the reviewer fills based on
 * its scrutiny of audit_notes + verification_summary + the transcript.
 * Each entry is a single 1-2 sentence concern.
 */
export const StressTestProfileLevel = z.object({
  catalog_vs_evidence_concerns: z.array(z.string().min(1).max(500)),
  consistency_concerns: z.array(z.string().min(1).max(500)),
  coverage_concerns: z.array(z.string().min(1).max(500)),
});
export type StressTestProfileLevelType = z.infer<typeof StressTestProfileLevel>;

export const StressTestResult = z.object({
  per_competency: z.array(StressTestCompetencyAnnotation),
  profile_level: StressTestProfileLevel,
  overall_assessment: StressTestOverall,
  summary: z.string().min(1).max(800),
});
export type StressTestResultType = z.infer<typeof StressTestResult>;

/**
 * OpenAI strict-mode JSON Schema for the reviewer output. The Vercel
 * AI SDK's `Output.object` accepts this. Mirror Zod fields exactly;
 * strict mode requires every `properties` key to also appear in
 * `required`, and nullable union types are encoded as
 * `"type": ["string", "null"]`.
 */
export const stressTestResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['per_competency', 'profile_level', 'overall_assessment', 'summary'],
  properties: {
    per_competency: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['competency_index', 'confidence', 'concerns', 'suggested_adjustments'],
        properties: {
          competency_index: { type: 'integer', minimum: 0 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low', 'disputed'] },
          concerns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
          suggested_adjustments: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['k_depth', 'u_depth', 'd_depth'],
                properties: {
                  k_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
                  u_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
                  d_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
                },
              },
            ],
          },
        },
      },
    },
    profile_level: {
      type: 'object',
      additionalProperties: false,
      required: ['catalog_vs_evidence_concerns', 'consistency_concerns', 'coverage_concerns'],
      properties: {
        catalog_vs_evidence_concerns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
        consistency_concerns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
        coverage_concerns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
      },
    },
    overall_assessment: { type: 'string', enum: ['sound', 'mixed', 'questionable'] },
    summary: { type: 'string', minLength: 1, maxLength: 800 },
  },
} as const;
