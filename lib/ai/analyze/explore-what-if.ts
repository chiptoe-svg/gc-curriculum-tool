import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import {
  whatIfResultSchema,
  type WhatIfResult,
  type TargetSpec,
  type ExploreAnalysis,
} from '@/lib/ai/explore/schema';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const targetDepthJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['k', 'u', 'd'],
  properties: {
    k: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
    u: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
    d: { type: 'integer', minimum: 0, maximum: 5 },
  },
} as const;

const whatIfJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshot_id', 'target_id', 'change_prose', 'generated_at', 'verdict', 'worth_doing', 'competency_changes', 'alignment_deltas', 'caveats'],
  properties: {
    snapshot_id: { type: 'string', minLength: 1 },
    target_id: { type: 'string', minLength: 1 },
    change_prose: { type: 'string', minLength: 1 },
    generated_at: { type: 'string', minLength: 1 },
    verdict: { type: 'string', minLength: 1 },
    worth_doing: { type: 'string', enum: ['high_value', 'modest_value', 'low_value', 'counterproductive'] },
    competency_changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['competency', 'from_depth', 'to_depth', 'rationale'],
        properties: {
          competency: { type: 'string', minLength: 1 },
          from_depth: targetDepthJsonSchema,
          to_depth: targetDepthJsonSchema,
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
    alignment_deltas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target_statement', 'before_status', 'after_status', 'note'],
        properties: {
          target_statement: { type: 'string', minLength: 1 },
          before_status: { type: 'string', enum: ['covered', 'partial', 'underdeveloped', 'missing'] },
          after_status: { type: 'string', enum: ['covered', 'partial', 'underdeveloped', 'missing'] },
          note: { type: 'string', minLength: 1 },
        },
      },
    },
    caveats: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface SimulateWhatIfInput {
  snapshotId: string;
  targetId: string;
  snapshotProfile: CaptureProfile;
  targetSpec: TargetSpec;
  /** The previous analysis row, if one exists, to ground the before-state. */
  priorAnalysis: ExploreAnalysis | null;
  changeProse: string;
}

export interface SimulateWhatIfResult {
  result: WhatIfResult;
  model: string;
  costUsdCents: number;
}

export async function simulateWhatIf(input: SimulateWhatIfInput): Promise<SimulateWhatIfResult> {
  if (!input.changeProse.trim()) throw new Error('changeProse is required');
  const provider = await getProviderForFunction('explore-what-if');
  const systemPrompt = await loadPrompt('explore-what-if');

  const userMessage = [
    `**Snapshot ID:** ${input.snapshotId}`,
    `**Target ID:** ${input.targetId}`,
    '',
    '**Proposed change:**',
    input.changeProse.trim(),
    '',
    '---',
    '',
    '**Snapshot profile (the current state):**',
    JSON.stringify(input.snapshotProfile, null, 2),
    '',
    '---',
    '',
    '**Target spec:**',
    JSON.stringify(input.targetSpec, null, 2),
    '',
    '---',
    '',
    input.priorAnalysis
      ? '**Current alignment analysis (the before-state):**\n' + JSON.stringify(input.priorAnalysis, null, 2)
      : '**Current alignment analysis:** (none — reason from snapshot + target only)',
    '',
    '---',
    '',
    'Simulate the effect of the proposed change. Set snapshot_id and target_id',
    'to the values above and change_prose to the verbatim proposal. Be',
    'conservative — a single change rarely moves more than 2-4 competencies.',
  ].join('\n');

  const result = await provider.complete<WhatIfResult>({
    systemPrompt,
    userMessage,
    schemaName: 'explore_what_if_v1',
    jsonSchema: whatIfJsonSchema as unknown as object,
    validate: (raw: unknown) => whatIfResultSchema.parse(raw),
  });

  return { result: result.data, model: provider.model, costUsdCents: result.costUsdCents };
}
