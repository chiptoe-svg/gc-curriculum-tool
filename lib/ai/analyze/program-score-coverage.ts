import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

/**
 * Score a snapshot against one career target's sub-competencies.
 * Produces one row per sub-competency, each carrying K/U/D depths +
 * evidence + confidence + rationale.
 */

const coverageCellSchema = z.object({
  sub_competency_id: z.string().min(1),
  matched_competency: z.string().nullable(),
  k_depth: z.number().int().min(0).max(5).nullable(),
  u_depth: z.number().int().min(0).max(5).nullable(),
  d_depth: z.number().int().min(0).max(5),
  evidence_excerpt: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  rationale: z.string().min(1),
});

const coverageResultSchema = z.object({
  snapshot_id: z.string(),
  career_target_id: z.string(),
  generated_at: z.string(),
  cells: z.array(coverageCellSchema).min(1),
});
export type ProgramCoverageResult = z.infer<typeof coverageResultSchema>;
export type ProgramCoverageCell = z.infer<typeof coverageCellSchema>;

const coverageJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshot_id', 'career_target_id', 'generated_at', 'cells'],
  properties: {
    snapshot_id: { type: 'string', minLength: 1 },
    career_target_id: { type: 'string', minLength: 1 },
    generated_at: { type: 'string', minLength: 1 },
    cells: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sub_competency_id',
          'matched_competency',
          'k_depth',
          'u_depth',
          'd_depth',
          'evidence_excerpt',
          'confidence',
          'rationale',
        ],
        properties: {
          sub_competency_id: { type: 'string', minLength: 1 },
          matched_competency: { type: ['string', 'null'] },
          k_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          u_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          d_depth: { type: 'integer', minimum: 0, maximum: 5 },
          evidence_excerpt: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

export interface ScoreCoverageInput {
  snapshotId: string;
  courseCode: string;
  snapshotProfile: CaptureProfile;
  careerTarget: {
    id: string;
    name: string;
    shortDefinition: string;
    knowDescriptors: string[];
    understandDescriptors: string[];
    doDescriptors: string[];
  };
  subCompetencies: Array<{
    id: string;
    name: string;
    knowDescriptor: string;
    understandDescriptor: string;
    doDescriptor: string;
    displayOrder: number;
  }>;
}

export interface ScoreCoverageResult {
  result: ProgramCoverageResult;
  model: string;
  /** Paid-provider cost for this scoring call, in 1/100-of-a-cent units (0 on campus/local). */
  costUsdCents: number;
}

export async function scoreSnapshotAgainstTarget(input: ScoreCoverageInput): Promise<ScoreCoverageResult> {
  const provider = await getProviderForFunction('program-score-coverage');
  const systemPrompt = await loadPrompt('program-score-coverage');

  const targetContext = {
    id: input.careerTarget.id,
    name: input.careerTarget.name,
    short_definition: input.careerTarget.shortDefinition,
    know_descriptors: input.careerTarget.knowDescriptors,
    understand_descriptors: input.careerTarget.understandDescriptors,
    do_descriptors: input.careerTarget.doDescriptors,
    sub_competencies: input.subCompetencies.map(s => ({
      id: s.id,
      name: s.name,
      know_descriptor: s.knowDescriptor,
      understand_descriptor: s.understandDescriptor,
      do_descriptor: s.doDescriptor,
    })),
  };

  const userMessage = [
    `**Snapshot ID:** ${input.snapshotId}`,
    `**Course:** ${input.courseCode}`,
    '',
    '**Snapshot profile:**',
    JSON.stringify(input.snapshotProfile, null, 2),
    '',
    '---',
    '',
    '**Career target:**',
    JSON.stringify(targetContext, null, 2),
    '',
    '---',
    '',
    'Score every sub-competency in the target against this snapshot per',
    'the system instructions. Produce one cell entry per sub-competency,',
    'using the sub-competency.id verbatim. Set snapshot_id and',
    'career_target_id to the values above and generated_at to the current',
    'ISO timestamp.',
  ].join('\n');

  const result = await provider.complete<ProgramCoverageResult>({
    systemPrompt,
    userMessage,
    schemaName: 'program_coverage_v1',
    jsonSchema: coverageJsonSchema as unknown as object,
    validate: (raw: unknown) => coverageResultSchema.parse(raw),
  });

  return { result: result.data, model: provider.model, costUsdCents: result.costUsdCents };
}
