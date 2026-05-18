import { z } from 'zod';

const reasoningField = z.string().min(20, 'reasoning must be at least 20 characters');

export const kudOutcomesSchema = z.object({
  description: z.string().min(1),
  know: z.array(z.string().min(1)).min(1).max(7),
  understand: z.array(z.string().min(1)).min(1).max(7),
  do: z.array(z.string().min(1)).min(1).max(7),
});

export const coverageScoreSchema = z.object({
  subCompetencyId: z.string().min(1),
  kudLevel: z.enum(['know', 'understand', 'do', 'not_addressed']),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: reasoningField,
});
export const coverageScoresSchema = z.array(coverageScoreSchema);

export const prerequisiteClaimSchema = z.object({
  subCompetencyId: z.string().min(1),
  expectedKudLevel: z.enum(['know', 'understand', 'do']),
  rationale: z.string().min(10),
});
export const prerequisiteClaimsSchema = z.array(prerequisiteClaimSchema);

export const prerequisiteGapSchema = z.object({
  subCompetencyId: z.string().min(1),
  expectedKudLevel: z.enum(['know', 'understand', 'do']),
  status: z.enum(['met', 'underdeveloped', 'missing']),
  upstreamEvidence: z.string().min(10),
  reasoning: reasoningField,
});
export const prerequisiteGapsSchema = z.array(prerequisiteGapSchema);

// JSON Schema (Draft 2020-12) versions for OpenAI's response_format
// These are derived from the Zod schemas above. Each is wrapped in the
// "single root object" shape that OpenAI structured-outputs requires
// (the API insists on an object, never a top-level array, so we wrap).
export const kudOutcomesJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'know', 'understand', 'do'],
  properties: {
    description: { type: 'string', minLength: 1 },
    know: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'string', minLength: 1 } },
    understand: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'string', minLength: 1 } },
    do: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'string', minLength: 1 } },
  },
} as const;

export const coverageScoresJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scores'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subCompetencyId', 'kudLevel', 'confidence', 'reasoning'],
        properties: {
          subCompetencyId: { type: 'string' },
          kudLevel: { type: 'string', enum: ['know', 'understand', 'do', 'not_addressed'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reasoning: { type: 'string', minLength: 20 },
        },
      },
    },
  },
} as const;

export const prerequisiteClaimsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subCompetencyId', 'expectedKudLevel', 'rationale'],
        properties: {
          subCompetencyId: { type: 'string' },
          expectedKudLevel: { type: 'string', enum: ['know', 'understand', 'do'] },
          rationale: { type: 'string', minLength: 10 },
        },
      },
    },
  },
} as const;

export const prerequisiteGapsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subCompetencyId', 'expectedKudLevel', 'status', 'upstreamEvidence', 'reasoning'],
        properties: {
          subCompetencyId: { type: 'string' },
          expectedKudLevel: { type: 'string', enum: ['know', 'understand', 'do'] },
          status: { type: 'string', enum: ['met', 'underdeveloped', 'missing'] },
          upstreamEvidence: { type: 'string', minLength: 10 },
          reasoning: { type: 'string', minLength: 20 },
        },
      },
    },
  },
} as const;
