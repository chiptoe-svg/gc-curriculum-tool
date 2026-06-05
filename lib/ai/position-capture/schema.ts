import { z } from 'zod';

/**
 * PositionProfile — output of a completed position capture's Page 6 agent
 * interview + synthesis. Persisted as the `profile` jsonb on
 * position_captures rows when completeness='interviewed'.
 *
 * Anchored to one specific hire scenario (this job at this company),
 * not "the field" abstractly. KUD+ are framed as qualification /
 * day-1-success measures rather than learning outcomes.
 */

/**
 * required_for_success K/U/D are anchored to DAY ONE, ENTRY LEVEL — what a
 * new hire is expected to do on day one, not eventual mastery. Trajectory is
 * captured separately (PositionProfile.trajectory) and is NEVER the comparand.
 * Above-floor depths must point at something the partner actually said
 * (evidenced_by); a vague endorsement is scored at the floor, not inflated.
 */
export const KudDepth = z.object({
  k_depth: z.number().int().min(0).max(5).nullable(),
  u_depth: z.number().int().min(0).max(5).nullable(),
  d_depth: z.number().int().min(0).max(5).nullable(),
  rationale: z.string().min(1).max(800),
  evidenced_by: z.array(z.string()).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
}).superRefine((kud, ctx) => {
  const aboveFloor = (kud.k_depth ?? 0) > 1 || (kud.u_depth ?? 0) > 0 || (kud.d_depth ?? 0) > 0;
  if (aboveFloor && (!kud.evidenced_by || kud.evidenced_by.length === 0)) {
    ctx.addIssue({ code: 'custom', path: ['evidenced_by'],
      message: 'above-floor demand depth requires evidenced_by — a vague endorsement with no concrete signal should be scored at the floor.' });
  }
});

export const PositionCompetency = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  // Nullable structured link to a catalog sub-competency, set by synthesis when a
  // qualifying competency clearly maps to one (best-effort; no FK enforcement at
  // parse time). Free-text name/description stay as the human layer; this id is the
  // JOIN KEY for the future demand-vs-attainment comparison (audit step 4).
  sub_competency_id: z.string().nullable(),
  required_for_success: KudDepth,
  notes: z.string().max(800).nullable(),
});

export const PositionProfile = z.object({
  essence: z.object({
    one_sentence: z.string().min(1).max(300),
    what_this_role_is: z.string().min(1).max(1500),
    what_it_isnt: z.string().min(1).max(1000),
  }),
  qualifying_competencies: z.array(PositionCompetency).min(1).max(20),
  dealbreakers: z.array(z.object({
    description: z.string().min(1).max(500),
    week_one_signal: z.string().min(1).max(500),
  })),
  hiring_signals: z.array(z.object({
    signal: z.string().min(1).max(300),
    weight: z.enum(['strong', 'moderate', 'context-dependent']),
  })),
  trajectory: z.object({
    year_1: z.string().min(1).max(800),
    year_2_to_3: z.string().min(1).max(800),
  }),
  partner_voice_summary: z.string().min(1).max(2000),
  generated_at: z.string().min(1),
});
export type PositionProfileType = z.infer<typeof PositionProfile>;

export const positionProfileJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['essence', 'qualifying_competencies', 'dealbreakers', 'hiring_signals', 'trajectory', 'partner_voice_summary', 'generated_at'],
  properties: {
    essence: {
      type: 'object',
      additionalProperties: false,
      required: ['one_sentence', 'what_this_role_is', 'what_it_isnt'],
      properties: {
        one_sentence: { type: 'string', minLength: 1, maxLength: 300 },
        what_this_role_is: { type: 'string', minLength: 1, maxLength: 1500 },
        what_it_isnt: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
    qualifying_competencies: {
      type: 'array', minItems: 1, maxItems: 20,
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'description', 'sub_competency_id', 'required_for_success', 'notes'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1, maxLength: 1000 },
          sub_competency_id: { type: ['string', 'null'] },
          required_for_success: {
            type: 'object', additionalProperties: false,
            required: ['k_depth', 'u_depth', 'd_depth', 'rationale', 'evidenced_by', 'confidence'],
            properties: {
              k_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              u_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              d_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              rationale: { type: 'string', minLength: 1, maxLength: 800 },
              evidenced_by: { type: ['array', 'null'], items: { type: 'string' } },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
          },
          notes: { type: ['string', 'null'], maxLength: 800 },
        },
      },
    },
    dealbreakers: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['description', 'week_one_signal'],
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 500 },
          week_one_signal: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    hiring_signals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['signal', 'weight'],
        properties: {
          signal: { type: 'string', minLength: 1, maxLength: 300 },
          weight: { type: 'string', enum: ['strong', 'moderate', 'context-dependent'] },
        },
      },
    },
    trajectory: {
      type: 'object', additionalProperties: false,
      required: ['year_1', 'year_2_to_3'],
      properties: {
        year_1: { type: 'string', minLength: 1, maxLength: 800 },
        year_2_to_3: { type: 'string', minLength: 1, maxLength: 800 },
      },
    },
    partner_voice_summary: { type: 'string', minLength: 1, maxLength: 2000 },
    generated_at: { type: 'string', minLength: 1 },
  },
} as const;
