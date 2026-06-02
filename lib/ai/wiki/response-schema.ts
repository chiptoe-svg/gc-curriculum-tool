import { z } from 'zod';

/**
 * Per-turn structured response from the curriculum-chat agent.
 *
 * Simpler than the audit agent's response:
 *   - `response` is the markdown reply the user sees
 *   - `citations` is the structured evidence trail (wiki paths + excerpts)
 *
 * No readiness score, no per-turn follow-up question — this is free-form
 * conversation grounded in the wiki, not a structured audit progression.
 */

const WikiCitation = z.object({
  /** Repo-relative path to the wiki page (e.g. "courses/gc-4800.md"). */
  path: z.string(),
  /** Up-to-200-char verbatim excerpt the assistant relied on. */
  excerpt: z.string().max(200),
});

export const CurriculumChatResponseSchema = z.object({
  response: z.string(),
  citations: z.array(WikiCitation),
});

export type CurriculumChatResponse = z.infer<typeof CurriculumChatResponseSchema>;
export type CurriculumChatCitation = z.infer<typeof WikiCitation>;

export const CurriculumChatResponseJsonSchema = {
  type: 'object',
  properties: {
    response: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          excerpt: { type: 'string', maxLength: 200 },
        },
        required: ['path', 'excerpt'],
        additionalProperties: false,
      },
    },
  },
  required: ['response', 'citations'],
  additionalProperties: false,
} as const;
