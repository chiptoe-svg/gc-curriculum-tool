import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { customTargetSpecSchema, type CustomTargetSpec } from '@/lib/ai/explore/schema';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

/**
 * JSON Schema mirror for OpenAI strict structured-output.
 * Tracks customTargetSpecSchema in lib/ai/explore/schema.ts.
 */
const customTargetJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'competencies'],
  properties: {
    kind: { type: 'string', enum: ['custom'] },
    competencies: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'type', 'target_depth', 'rationale'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['technical', 'foundational'] },
          target_depth: {
            type: 'object',
            additionalProperties: false,
            required: ['k', 'u', 'd'],
            properties: {
              k: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              u: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              d: { type: 'integer', minimum: 0, maximum: 5 },
            },
          },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

export interface DraftCustomTargetInput {
  prose: string;
  snapshotProfile: CaptureProfile;
}

export interface DraftCustomTargetResult {
  target: CustomTargetSpec;
  model: string;
  costUsdCents: number;
}

export async function draftCustomTarget(input: DraftCustomTargetInput): Promise<DraftCustomTargetResult> {
  if (!input.prose.trim()) throw new Error('prose is required');
  const provider = await getProviderForFunction('explore-draft-target');
  const systemPrompt = await loadPrompt('explore-draft-target');

  const userMessage = [
    '**Instructor goal (prose):**',
    input.prose.trim(),
    '',
    '---',
    '',
    '**Current snapshot of the course:**',
    JSON.stringify(input.snapshotProfile, null, 2),
    '',
    '---',
    '',
    'Draft a structured custom TargetSpec that translates the prose goal',
    'into 3–10 target competencies, each with K/U/D target depths and a',
    'rationale. Ground every competency in something the course could',
    'reasonably do; flag anything aspirational in the rationale.',
  ].join('\n');

  const result = await provider.complete<CustomTargetSpec>({
    systemPrompt,
    userMessage,
    schemaName: 'explore_custom_target_v1',
    jsonSchema: customTargetJsonSchema as unknown as object,
    validate: (raw: unknown) => customTargetSpecSchema.parse(raw),
  });

  return { target: result.data, model: provider.model, costUsdCents: result.costUsdCents };
}
