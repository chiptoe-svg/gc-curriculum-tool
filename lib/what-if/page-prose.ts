import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction, type CompletionTelemetry } from '@/lib/ai/provider';
import type { Kud, KnockOn, WhatIfEstimate, WhatIfProfile, WhatIfProse } from './types';

import { RATING_IN_PROSE } from './rating-pattern';
export { RATING_IN_PROSE };

const noRating = (s: string) => !RATING_IN_PROSE.test(s);
const text = z.string().min(1).refine(noRating, 'Do not state a rating in the text.');

const proseSchema = z.object({
  description: text,
  whatChanges: text,
  neighbors: text,
  questions: z.array(text).min(3).max(5),
  summary: text,
  title: text.nullable(),
});

// Strict OpenAI JSON schema: every property in `required`, additionalProperties false, optional values nullable.
export const WHAT_IF_PROSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'whatChanges', 'neighbors', 'questions', 'summary', 'title'],
  properties: {
    description: { type: 'string' },
    whatChanges: { type: 'string' },
    neighbors: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    title: { type: ['string', 'null'] },
  },
};

const DIMENSIONS: Array<[keyof Kud, string]> = [['k', 'knowing'], ['u', 'understanding'], ['d', 'doing']];

function movement(before: Kud, after: Kud): string {
  const parts = DIMENSIONS.flatMap(([key, label]) => {
    const b = before[key], a = after[key];
    if (b === null || a === null || a === b) return [];
    return [`${label} ${a > b ? 'goes up' : 'goes down'}`];
  });
  return parts.join(', ');
}

function ratingLines(profile: WhatIfProfile): string {
  const lines = profile.ratings.flatMap(r => {
    if (r.status === 'new') return [`- ${r.statement}: new competency`];
    if (r.status === 'moved' && r.before) return [`- ${r.statement}: ${movement(r.before, r.kud)}`];
    return [];
  });
  return lines.join('\n') || '(no ratings move)';
}

function incomingLines(profile: WhatIfProfile): string {
  const word = { new: 'new', raised: 'raised', dropped: 'dropped' } as const;
  return profile.incomingChanges.map(c => `- ${c.statement}: expectation of incoming students is ${word[c.kind]}`).join('\n')
    || '(no change)';
}

function neighborLines(k: KnockOn): string {
  const later = k.laterCourses.map(c =>
    `- ${c.courseCode}: a gap in "${c.label}" would ${c.effect === 'closed' ? 'close' : 'open'}`);
  const earlier = k.earlierCourses.map(c => {
    const state = c.status === 'met' ? 'is already covered by earlier courses'
      : c.status === 'not_met' ? 'is not covered by earlier courses' : 'cannot be checked against earlier courses';
    return `- Expected of incoming students: ${c.statement}; it ${state}`;
  });
  const careers = k.careerTargets.map(c => `- ${c.targetName}, ${c.label}: ${c.direction === 'up' ? 'goes up' : 'goes down'}`);
  return [...later, ...earlier, ...careers].join('\n') || '(no effect on neighboring courses or career targets)';
}

export async function writeWhatIfProse(input: {
  courseCode: string;
  courseTitle: string;
  currentDescription: string;
  estimate: WhatIfEstimate;
  profile: WhatIfProfile;
  knockOn: KnockOn;
  needsTitle: boolean;
}): Promise<{ prose: WhatIfProse; title: string | null; summary: string; telemetry: CompletionTelemetry }> {
  const provider = await getProviderForFunction('what-if-page', { courseCode: input.courseCode });
  const systemPrompt = await loadPrompt('what-if-page');

  const changes = input.estimate.changeItems.map(c => `- ${c.kind}: ${c.description}`).join('\n') || '(no changes listed)';
  const userMessage = [
    `**Course:** ${input.courseCode}, ${input.courseTitle}`,
    '',
    '**Current description:**',
    input.currentDescription || '(none)',
    '',
    '**Proposed changes:**',
    changes,
    '',
    '**What moves in this course:**',
    ratingLines(input.profile),
    '',
    '**What incoming students are expected to bring:**',
    incomingLines(input.profile),
    '',
    '**Neighboring courses and career targets:**',
    neighborLines(input.knockOn),
    '',
    input.needsTitle
      ? 'Write a short title for this what-if.'
      : 'Do not write a title; set title to null.',
  ].join('\n');

  const result = await provider.complete<z.infer<typeof proseSchema>>({
    systemPrompt,
    userMessage,
    schemaName: 'what_if_page_v1',
    jsonSchema: WHAT_IF_PROSE_JSON_SCHEMA,
    validate: (raw: unknown) => proseSchema.parse(raw),
  });

  const { data, ...telemetry } = result;
  return {
    prose: { description: data.description, whatChanges: data.whatChanges, neighbors: data.neighbors, questions: data.questions },
    title: input.needsTitle ? data.title : null,
    summary: data.summary,
    telemetry,
  };
}
