import { z } from 'zod';

/**
 * Per-turn structured response from the explore thinking-partner agent.
 *
 * Mirrors CurriculumChatResponseSchema exactly — same citation shape,
 * same `{ response, citations }` envelope. The only reason for a
 * separate file is a separate schemaName in the JSON-schema literal.
 *
 * Scenario CARD data rides separate stream events, NOT this response.
 *
 *   - `response` is the markdown reply the user sees
 *   - `citations` is the structured evidence trail (wiki paths + excerpts)
 */

const ExploreAgentCitation = z.object({
  /** Repo-relative path to the wiki page (e.g. "courses/gc-4800.md") — null for material-chunk citations. */
  path: z.string().nullable(),
  /** Up-to-200-char verbatim excerpt the assistant relied on. */
  excerpt: z.string().max(200),
  /** Material-chunk citation fields — null for wiki-page citations. */
  courseCode: z.string().nullable(),
  materialId: z.string().nullable(),
  fileName: z.string().nullable(),
  chunkId: z.string().nullable(),
});

export const ExploreAgentResponseSchema = z.object({
  response: z.string().min(1),
  citations: z.array(ExploreAgentCitation),
});

export type ExploreAgentResponse = z.infer<typeof ExploreAgentResponseSchema>;
export type ExploreAgentCitationType = z.infer<typeof ExploreAgentCitation>;

export const ExploreAgentResponseJsonSchema = {
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
