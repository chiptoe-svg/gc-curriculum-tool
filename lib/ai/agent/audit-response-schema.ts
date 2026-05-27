import { z } from 'zod';

/**
 * Per-turn structured response from the audit-chat agent.
 *
 * Contract is the "Structured per-turn response" section of
 * lib/ai/prompts/capture-chat-agent.md and the spec's Phase B.
 *
 *   finding   — one paragraph; cites specific evidence by name
 *   question  — one focused follow-up on the same topic
 *   citations — evidence trail; type='chunk' references a retrieved
 *               chunkId, type='instructor' references a prior message
 *   readiness — 0-100 score + lists of covered/remaining audit areas
 */

const Citation = z.object({
  type: z.enum(['chunk', 'instructor']),
  chunkId: z.string().optional(),
  messageId: z.string().optional(),
  excerpt: z.string().max(200),
});

const Readiness = z.object({
  score: z.number().int().min(0).max(100),
  covered: z.array(z.string()),
  remaining: z.array(z.string()),
  good_enough_to_generate: z.boolean(),
});

export const AuditResponseSchema = z.object({
  finding: z.string(),
  question: z.string(),
  citations: z.array(Citation),
  readiness: Readiness,
});

export type AuditResponse = z.infer<typeof AuditResponseSchema>;
export type AuditCitation = z.infer<typeof Citation>;
export type AuditReadiness = z.infer<typeof Readiness>;

/** JSON Schema for provider.completeWithTools()'s jsonSchema arg. */
export const AuditResponseJsonSchema = {
  type: 'object',
  properties: {
    finding: { type: 'string' },
    question: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { enum: ['chunk', 'instructor'] },
          chunkId: { type: 'string' },
          messageId: { type: 'string' },
          excerpt: { type: 'string', maxLength: 200 },
        },
        required: ['type', 'excerpt'],
        additionalProperties: false,
      },
    },
    readiness: {
      type: 'object',
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        covered: { type: 'array', items: { type: 'string' } },
        remaining: { type: 'array', items: { type: 'string' } },
        good_enough_to_generate: { type: 'boolean' },
      },
      required: ['score', 'covered', 'remaining', 'good_enough_to_generate'],
      additionalProperties: false,
    },
  },
  required: ['finding', 'question', 'citations', 'readiness'],
  additionalProperties: false,
} as const;
