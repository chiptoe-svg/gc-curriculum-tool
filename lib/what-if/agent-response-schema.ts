import { z } from 'zod';

/**
 * Per-turn structured response from the what-if assistant: the same
 * `{ response, citations }` envelope as the Explore agent, kept in its own
 * file so the what-if build does not depend on `lib/ai/explore`.
 *
 * Quick-estimate cards ride separate stream events, not this response.
 */
const citationSchema = z.object({
  /** Repo-relative wiki path (e.g. "courses/gc-4800.md"); null for material-chunk citations. */
  path: z.string().nullable(),
  /** Up-to-200-char verbatim excerpt the assistant relied on. */
  excerpt: z.string().max(200),
  courseCode: z.string().nullable(),
  materialId: z.string().nullable(),
  fileName: z.string().nullable(),
  chunkId: z.string().nullable(),
});

export const whatIfAgentResponseSchema = z.object({
  response: z.string().min(1),
  citations: z.array(citationSchema),
});
export type WhatIfAgentResponse = z.infer<typeof whatIfAgentResponseSchema>;

export const WHAT_IF_AGENT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    response: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: ['string', 'null'] },
          excerpt: { type: 'string', maxLength: 200 },
          courseCode: { type: ['string', 'null'] },
          materialId: { type: ['string', 'null'] },
          fileName: { type: ['string', 'null'] },
          chunkId: { type: ['string', 'null'] },
        },
        required: ['path', 'excerpt', 'courseCode', 'materialId', 'fileName', 'chunkId'],
        additionalProperties: false,
      },
    },
  },
  required: ['response', 'citations'],
  additionalProperties: false,
} as const;
