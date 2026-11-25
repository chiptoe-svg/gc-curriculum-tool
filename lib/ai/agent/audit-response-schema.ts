import { z } from 'zod';
import type { StageId } from '@/lib/capture/staged/stages';

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

// Citation: one of chunkId / messageId is set per type. Both must accept
// null because OpenAI strict-mode JSON schema can't encode "optional";
// the model emits null for the unused slot.
const Citation = z.object({
  type: z.enum(['chunk', 'instructor']),
  chunkId: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  excerpt: z.string().max(200),
});

const Readiness = z.object({
  score: z.number().int().min(0).max(100),
  covered: z.array(z.string()),
  remaining: z.array(z.string()),
  good_enough_to_generate: z.boolean(),
});

/**
 * Staged interviews only (plan 2026-11-25, Task 6): where the turn sits in the six stages. The app sets it,
 * never the model, so it is NOT in AuditResponseJsonSchema and the classic loop never emits it.
 */
const StageIdSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]) satisfies z.ZodType<StageId>;

const StagedBlock = z.object({
  stage: StageIdSchema,
  stageTitle: z.string(),
  stageProgress: z.array(z.object({
    id: StageIdSchema,
    title: z.string(),
    status: z.enum(['done', 'active', 'upcoming']),
  })),
  questionsAsked: z.number().int().min(0),
  cap: z.literal(20),
  slotAsked: z.string(),
  kind: z.enum(['question', 'follow_up', 'recap', 'answer_only']),
  /** Set on the row that answered a Finish request; the ledger's `finish` event is read from it. */
  finishRequested: z.boolean().optional(),
});

export const AuditResponseSchema = z.object({
  finding: z.string(),
  question: z.string(),
  citations: z.array(Citation),
  readiness: Readiness,
  staged: StagedBlock.optional(),
});

export type AuditResponse = z.infer<typeof AuditResponseSchema>;
export type AuditCitation = z.infer<typeof Citation>;
export type AuditReadiness = z.infer<typeof Readiness>;
export type AuditStagedBlock = z.infer<typeof StagedBlock>;

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
        // OpenAI strict-mode structured-output requires `required` to list
        // every property in `properties`. Optional fields (chunkId,
        // messageId — one is set depending on citation type) are encoded
        // as nullable union types instead. The Zod schema's `.optional()`
        // on these fields accepts both undefined and null.
        properties: {
          type: { enum: ['chunk', 'instructor'] },
          chunkId: { type: ['string', 'null'] },
          messageId: { type: ['string', 'null'] },
          excerpt: { type: 'string', maxLength: 200 },
        },
        required: ['type', 'chunkId', 'messageId', 'excerpt'],
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
