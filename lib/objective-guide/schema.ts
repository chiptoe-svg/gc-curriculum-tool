import { z } from 'zod';

/**
 * Objective assessment guide (spec 2026-10-05). `ModelGuide` is what the
 * `objective-evidence-guide` model returns; `ObjectiveGuide` is what is stored
 * after the deterministic check — it adds a checklist derived from the
 * surviving evidence (never from the model), so the checklist can only name
 * items that already passed the Canvas name check.
 */
export const MEASURES = ['clear', 'partial', 'none'] as const;
export type GuideMeasure = (typeof MEASURES)[number];

export const GuideEvidenceSchema = z.object({
  assignment: z.string().min(1),
  rubric_row: z.string().min(1).nullable(),
});
export type GuideEvidence = z.infer<typeof GuideEvidenceSchema>;

const ModelObjectiveSchema = z.object({
  objective: z.string().min(1),
  measure: z.enum(MEASURES),
  evidence: z.array(GuideEvidenceSchema),
  gather: z.string().min(1),
  suggestion: z.string().min(1).nullable(),
});

export const ModelGuideSchema = z.object({
  intro: z.string().min(1),
  objectives: z.array(ModelObjectiveSchema),
});
export type ModelGuide = z.infer<typeof ModelGuideSchema>;

export const ObjectiveGuideSchema = ModelGuideSchema.extend({
  checklist: z.array(GuideEvidenceSchema),
});
export type ObjectiveGuide = z.infer<typeof ObjectiveGuideSchema>;

// Strict-mode JSON schema: every property required, optional values are
// nullable unions, no additional properties anywhere (CLAUDE.md).
const evidenceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assignment', 'rubric_row'],
  properties: {
    assignment: { type: 'string' },
    rubric_row: { type: ['string', 'null'] },
  },
} as const;

export const modelGuideJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intro', 'objectives'],
  properties: {
    intro: { type: 'string' },
    objectives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['objective', 'measure', 'evidence', 'gather', 'suggestion'],
        properties: {
          objective: { type: 'string' },
          measure: { type: 'string', enum: ['clear', 'partial', 'none'] },
          evidence: { type: 'array', items: evidenceJsonSchema },
          gather: { type: 'string' },
          suggestion: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;
