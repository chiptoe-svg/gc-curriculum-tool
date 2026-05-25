import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProvider } from '@/lib/ai/provider';
import {
  exploreAnalysisSchema,
  type ExploreAnalysis,
  type TargetSpec,
} from '@/lib/ai/explore/schema';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

/**
 * JSON Schema mirror for OpenAI strict structured-output.
 */
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

const targetDepthOrNullJsonSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['k', 'u', 'd'],
  properties: targetDepthJsonSchema.properties,
} as const;

const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshot_id', 'target_spec_id', 'generated_at', 'alignment', 'recommendations', 'audit_notes'],
  properties: {
    snapshot_id: { type: 'string', minLength: 1 },
    target_spec_id: { type: 'string', minLength: 1 },
    generated_at: { type: 'string', minLength: 1 },
    alignment: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target_statement', 'matched_snapshot_competency', 'target_depth', 'snapshot_depth', 'status', 'delta_notes'],
        properties: {
          target_statement: { type: 'string', minLength: 1 },
          matched_snapshot_competency: { type: ['string', 'null'] },
          target_depth: targetDepthJsonSchema,
          snapshot_depth: targetDepthOrNullJsonSchema,
          status: { type: 'string', enum: ['covered', 'partial', 'underdeveloped', 'missing'] },
          delta_notes: { type: 'string', minLength: 1 },
        },
      },
    },
    recommendations: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['priority', 'change', 'impact', 'would_affect'],
        properties: {
          priority: { type: 'integer', minimum: 1 },
          change: { type: 'string', minLength: 1 },
          impact: { type: 'string', minLength: 1 },
          would_affect: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['competency', 'from_depth', 'to_depth'],
              properties: {
                competency: { type: 'string' },
                from_depth: targetDepthJsonSchema,
                to_depth: targetDepthJsonSchema,
              },
            },
          },
        },
      },
    },
    audit_notes: {
      type: 'object',
      additionalProperties: false,
      required: ['gaps_addressed_by_recommendations', 'gaps_not_addressed', 'strengths_relative_to_target'],
      properties: {
        gaps_addressed_by_recommendations: { type: 'array', items: { type: 'string' } },
        gaps_not_addressed: { type: 'array', items: { type: 'string' } },
        strengths_relative_to_target: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

export interface CompareInput {
  snapshotId: string;
  targetId: string;
  snapshotProfile: CaptureProfile;
  targetSpec: TargetSpec;
}

export interface CompareResult {
  analysis: ExploreAnalysis;
  model: string;
}

export async function compareSnapshotToTarget(input: CompareInput): Promise<CompareResult> {
  const provider = getProvider();
  const systemPrompt = await loadPrompt('explore-compare');

  const userMessage = [
    `**Snapshot ID:** ${input.snapshotId}`,
    `**Target spec ID:** ${input.targetId}`,
    '',
    '**Snapshot profile (the "what is"):**',
    JSON.stringify(input.snapshotProfile, null, 2),
    '',
    '---',
    '',
    '**Target spec (the "what should be"):**',
    JSON.stringify(input.targetSpec, null, 2),
    '',
    '---',
    '',
    'Produce the alignment + recommendations analysis. Per the system',
    'instructions: status taxonomy, specific actionable recommendations',
    'ordered by impact, audit-notes lists. Set snapshot_id and',
    'target_spec_id to the values provided above.',
  ].join('\n');

  const result = await provider.complete<ExploreAnalysis>({
    systemPrompt,
    userMessage,
    schemaName: 'explore_analysis_v1',
    jsonSchema: analysisJsonSchema as unknown as object,
    validate: (raw: unknown) => exploreAnalysisSchema.parse(raw),
  });

  return { analysis: result.data, model: provider.model };
}
