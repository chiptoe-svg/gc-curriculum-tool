import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { changeObjectSchema, predictedDeltaSchema } from '@/lib/ai/explore/scenario';
import type { NeighborContext } from '@/lib/ai/explore/neighbor-context';

export const localDeltaResultSchema = z.object({
  change: changeObjectSchema,
  predictedDeltas: z.array(predictedDeltaSchema),
});
export type LocalDeltaResult = z.infer<typeof localDeltaResultSchema>;

// ---------------------------------------------------------------------------
// Strict OpenAI JSON schema — mirrors changeObjectSchema + predictedDeltaSchema
// field-for-field. Every object property MUST appear in `required`; optional /
// nullable fields use { type: ['T', 'null'] } rather than being omitted.
// ---------------------------------------------------------------------------

const incomingDemandJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'subCompetencyId', 'k', 'u', 'd'],
  properties: {
    label: { type: 'string', minLength: 1 },
    subCompetencyId: { type: ['string', 'null'] },
    k: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
    u: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
    d: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
  },
} as const;

const changeObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prose', 'activity', 'artifact', 'competencies', 'rubricCriteria', 'assumesIncoming'],
  properties: {
    prose: { type: 'string', minLength: 1 },
    activity: { type: 'string', minLength: 1 },
    artifact: { type: 'string', enum: ['graded', 'ungraded', 'formative', 'none'] },
    competencies: { type: 'array', items: { type: 'string', minLength: 1 } },
    rubricCriteria: { type: 'array', items: { type: 'string', minLength: 1 } },
    assumesIncoming: { type: 'array', items: incomingDemandJsonSchema },
  },
} as const;

const kudJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['k', 'u', 'd'],
  properties: {
    k: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
    u: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
    d: { type: 'integer', minimum: 0, maximum: 5 },
  },
} as const;

const predictedDeltaJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['competency', 'from', 'to', 'confidence', 'rationale'],
  properties: {
    competency: { type: 'string', minLength: 1 },
    from: kudJsonSchema,
    to: kudJsonSchema,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    rationale: { type: 'string', minLength: 1 },
  },
} as const;

export const localDeltaJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['change', 'predictedDeltas'],
  properties: {
    change: changeObjectJsonSchema,
    predictedDeltas: { type: 'array', items: predictedDeltaJsonSchema },
  },
} as const;

// ---------------------------------------------------------------------------
// Estimator
// ---------------------------------------------------------------------------

export async function estimateLocalDelta(
  courseCode: string,
  changeProse: string,
  neighbors: NeighborContext,
): Promise<LocalDeltaResult> {
  if (!changeProse.trim()) throw new Error('changeProse is required');
  const provider = await getProviderForFunction('explore-local-delta');
  const systemPrompt = await loadPrompt('explore-local-delta');

  const focalCompetencies = neighbors.focal.competencies
    .map(c => `  - ${c.statement} (K:${c.k_depth ?? 'null'} U:${c.u_depth ?? 'null'} D:${c.d_depth})`)
    .join('\n');

  const upstreamSummary = neighbors.upstream
    .map(p => {
      const comps = p.competencies.map(c => `    - ${c.statement} (D:${c.d_depth})`).join('\n');
      const incoming = p.incoming_expectations
        .map(e => `    - expects: ${e.statement}`)
        .join('\n');
      return `  ${p.courseCode}:\n${comps}\n${incoming}`;
    })
    .join('\n');

  const downstreamSummary = neighbors.downstream
    .map(p => {
      const comps = p.competencies.map(c => `    - ${c.statement} (D:${c.d_depth})`).join('\n');
      const incoming = p.incoming_expectations
        .map(e => `    - expects: ${e.statement}`)
        .join('\n');
      return `  ${p.courseCode}:\n${comps}\n${incoming}`;
    })
    .join('\n');

  const userMessage = [
    `**Course:** ${courseCode}`,
    '',
    '**Proposed change:**',
    changeProse.trim(),
    '',
    '---',
    '',
    `**Focal course competencies (${courseCode}):**`,
    focalCompetencies || '  (none)',
    '',
    '---',
    '',
    '**Upstream courses (what students bring in):**',
    upstreamSummary || '  (none)',
    '',
    '---',
    '',
    '**Downstream courses (what students go on to):**',
    downstreamSummary || '  (none)',
    '',
    '---',
    '',
    'Translate the proposed change into a structured change object and predicted KUD deltas.',
    'Only include competencies the change plausibly affects.',
    'A single change rarely moves any one dimension by more than 1 level.',
  ].join('\n');

  const result = await provider.complete<LocalDeltaResult>({
    systemPrompt,
    userMessage,
    schemaName: 'explore_local_delta_v1',
    jsonSchema: localDeltaJsonSchema as unknown as object,
    validate: (raw: unknown) => localDeltaResultSchema.parse(raw),
  });

  return result.data;
}
