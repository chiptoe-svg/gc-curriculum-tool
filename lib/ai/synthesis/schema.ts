import { z } from 'zod';

const jobTitleSchema = z.object({
  title: z.string().min(1),
  count: z.number().int().nonnegative(),
  partnerIds: z.array(z.string()),
});

const responsibilityThemeSchema = z.object({
  theme: z.string().min(1),
  quotedFrom: z.array(z.object({
    partnerId: z.string(),
    snippet: z.string().min(1),
  })),
});

const skillCountSchema = z.object({
  skill: z.string().min(1),
  count: z.number().int().nonnegative(),
});

const interviewThemeSchema = z.object({
  theme: z.string().min(1),
  examples: z.array(z.string().min(1)),
});

const salaryDistributionSchema = z.object({
  p25: z.number().int().optional(),
  p50: z.number().int().optional(),
  p75: z.number().int().optional(),
  n: z.number().int().nonnegative(),
});

const sampleQuoteSchema = z.object({
  partnerId: z.string(),
  quote: z.string().min(1),
});

const proposedKUDEditSchema = z.object({
  descriptor: z.enum(['know', 'understand', 'do']),
  type: z.enum(['addition', 'edit']),
  targetDescriptorIndex: z.number().int().nonnegative().optional(),
  proposedText: z.string().min(1),
  rationale: z.string().min(1),
  supportingPartnerIds: z.array(z.string()),
});

export const synthesisResultSchema = z.object({
  aggregatedJobTitles: z.array(jobTitleSchema),
  responsibilityThemes: z.array(responsibilityThemeSchema),
  commonRequiredSkills: z.array(skillCountSchema),
  commonNiceToHaveSkills: z.array(skillCountSchema),
  interviewQuestionThemes: z.array(interviewThemeSchema),
  salaryDistribution: salaryDistributionSchema,
  sampleQuotes: z.array(sampleQuoteSchema),
  proposedKUDEdits: z.array(proposedKUDEditSchema),
});

export type SynthesisResult = z.infer<typeof synthesisResultSchema>;

// JSON Schema for OpenAI structured outputs. Mirrors the Zod schema above.
// Keep in sync — if you change one, change the other.
export const synthesisResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'aggregatedJobTitles', 'responsibilityThemes', 'commonRequiredSkills',
    'commonNiceToHaveSkills', 'interviewQuestionThemes', 'salaryDistribution',
    'sampleQuotes', 'proposedKUDEdits',
  ],
  properties: {
    aggregatedJobTitles: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'count', 'partnerIds'],
        properties: {
          title: { type: 'string' },
          count: { type: 'integer', minimum: 0 },
          partnerIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    responsibilityThemes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['theme', 'quotedFrom'],
        properties: {
          theme: { type: 'string' },
          quotedFrom: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['partnerId', 'snippet'],
              properties: {
                partnerId: { type: 'string' },
                snippet: { type: 'string' },
              },
            },
          },
        },
      },
    },
    commonRequiredSkills: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['skill', 'count'],
        properties: { skill: { type: 'string' }, count: { type: 'integer', minimum: 0 } },
      },
    },
    commonNiceToHaveSkills: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['skill', 'count'],
        properties: { skill: { type: 'string' }, count: { type: 'integer', minimum: 0 } },
      },
    },
    interviewQuestionThemes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['theme', 'examples'],
        properties: {
          theme: { type: 'string' },
          examples: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    salaryDistribution: {
      type: 'object', additionalProperties: false,
      required: ['n'],
      properties: {
        p25: { type: 'integer' },
        p50: { type: 'integer' },
        p75: { type: 'integer' },
        n: { type: 'integer', minimum: 0 },
      },
    },
    sampleQuotes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['partnerId', 'quote'],
        properties: { partnerId: { type: 'string' }, quote: { type: 'string' } },
      },
    },
    proposedKUDEdits: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['descriptor', 'type', 'proposedText', 'rationale', 'supportingPartnerIds'],
        properties: {
          descriptor: { type: 'string', enum: ['know', 'understand', 'do'] },
          type: { type: 'string', enum: ['addition', 'edit'] },
          targetDescriptorIndex: { type: 'integer', minimum: 0 },
          proposedText: { type: 'string' },
          rationale: { type: 'string' },
          supportingPartnerIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;
