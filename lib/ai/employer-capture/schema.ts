import { z } from 'zod';

/**
 * Output of a completed employer interview. Per-partner per-career-target.
 * Persisted as the `profile` jsonb on career_captures rows.
 */

export const KudDepth = z.object({
  k_depth: z.number().int().min(0).max(5).nullable(),
  u_depth: z.number().int().min(0).max(5).nullable(),
  d_depth: z.number().int().min(0).max(5).nullable(),
  rationale: z.string().min(1).max(800),
});

export const CareerCaptureCompetency = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  expected_on_day_1: KudDepth,
  notes: z.string().max(800).nullable().optional(),
});

export const CareerCaptureProfile = z.object({
  role_shape: z.object({
    title_actual: z.string().min(1).max(200),
    day_to_day_summary: z.string().min(1).max(1500),
    first_90_days: z.string().min(1).max(1000),
    trajectory_12_24mo: z.string().min(1).max(1000),
  }),
  day_1_competencies: z.array(CareerCaptureCompetency).min(1).max(20),
  dealbreakers: z.array(z.object({
    description: z.string().min(1).max(500),
    why_it_matters: z.string().min(1).max(500),
  })),
  hiring_signals: z.array(z.object({
    signal: z.string().min(1).max(300),
    weight: z.enum(['strong', 'moderate', 'context-dependent']),
  })),
  divergence_from_catalog: z.array(z.object({
    observation: z.string().min(1).max(500),
    direction: z.enum(['catalog_overweights', 'catalog_underweights', 'catalog_missing']),
  })),
  partner_summary: z.string().min(1).max(2000),
  generated_at: z.string().min(1),
});
export type CareerCaptureProfileType = z.infer<typeof CareerCaptureProfile>;

/**
 * OpenAI strict-mode JSON Schema mirror. Every property listed in
 * `required`; nullable fields encoded as union types.
 */
export const careerCaptureProfileJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['role_shape', 'day_1_competencies', 'dealbreakers', 'hiring_signals', 'divergence_from_catalog', 'partner_summary', 'generated_at'],
  properties: {
    role_shape: {
      type: 'object',
      additionalProperties: false,
      required: ['title_actual', 'day_to_day_summary', 'first_90_days', 'trajectory_12_24mo'],
      properties: {
        title_actual: { type: 'string', minLength: 1, maxLength: 200 },
        day_to_day_summary: { type: 'string', minLength: 1, maxLength: 1500 },
        first_90_days: { type: 'string', minLength: 1, maxLength: 1000 },
        trajectory_12_24mo: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
    day_1_competencies: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'expected_on_day_1', 'notes'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1, maxLength: 1000 },
          expected_on_day_1: {
            type: 'object',
            additionalProperties: false,
            required: ['k_depth', 'u_depth', 'd_depth', 'rationale'],
            properties: {
              k_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              u_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              d_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              rationale: { type: 'string', minLength: 1, maxLength: 800 },
            },
          },
          notes: { type: ['string', 'null'], maxLength: 800 },
        },
      },
    },
    dealbreakers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'why_it_matters'],
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 500 },
          why_it_matters: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    hiring_signals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['signal', 'weight'],
        properties: {
          signal: { type: 'string', minLength: 1, maxLength: 300 },
          weight: { type: 'string', enum: ['strong', 'moderate', 'context-dependent'] },
        },
      },
    },
    divergence_from_catalog: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['observation', 'direction'],
        properties: {
          observation: { type: 'string', minLength: 1, maxLength: 500 },
          direction: { type: 'string', enum: ['catalog_overweights', 'catalog_underweights', 'catalog_missing'] },
        },
      },
    },
    partner_summary: { type: 'string', minLength: 1, maxLength: 2000 },
    generated_at: { type: 'string', minLength: 1 },
  },
} as const;
