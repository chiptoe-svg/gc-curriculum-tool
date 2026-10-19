import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

/**
 * Score a snapshot against a list of catalog competencies — no career-target
 * context (P0b Task 5: coverage scoring moved from per-target to per
 * competency; a competency can now be shared by several targets, so scoring
 * it once, against only its own K/U/D descriptors, replaces scoring it once
 * per target it happens to belong to). Produces one row per competency in
 * the input, each carrying K/U/D depths + evidence + confidence + rationale.
 */

const coverageCellSchema = z.object({
  competency_id: z.string().min(1),
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
  generated_at: z.string(),
  cells: z.array(coverageCellSchema).min(1),
});
export type ProgramCoverageResult = z.infer<typeof coverageResultSchema>;
export type CompetencyCoverageCell = z.infer<typeof coverageCellSchema>;

const coverageJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snapshot_id', 'generated_at', 'cells'],
  properties: {
    snapshot_id: { type: 'string', minLength: 1 },
    generated_at: { type: 'string', minLength: 1 },
    cells: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'competency_id',
          'matched_competency',
          'k_depth',
          'u_depth',
          'd_depth',
          'evidence_excerpt',
          'confidence',
          'rationale',
        ],
        properties: {
          competency_id: { type: 'string', minLength: 1 },
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

export interface ScoreCompetenciesInput {
  snapshotId: string;
  courseCode: string;
  snapshotProfile: CaptureProfile;
  competencies: Array<{
    id: string;
    name: string;
    knowDescriptor: string | null;
    understandDescriptor: string | null;
    doDescriptor: string;
  }>;
  /** Optional model override (e.g. for A/B'ing the producing model); default = the function's configured tier. */
  modelOverride?: string;
  /** Evaluation use only: reasoning effort for the override model (low | medium | high | xhigh). */
  reasoningEffortOverride?: string;
}

export interface ScoreCompetenciesResult {
  result: ProgramCoverageResult;
  model: string;
  /** Paid-provider cost for this scoring call, in 1/100-of-a-cent units (0 on campus/local). */
  costUsdCents: number;
}

export async function scoreSnapshotCompetencies(input: ScoreCompetenciesInput): Promise<ScoreCompetenciesResult> {
  const provider = await getProviderForFunction(
    'program-score-coverage',
    input.modelOverride ? { model: input.modelOverride, reasoningEffort: input.reasoningEffortOverride } : undefined,
  );
  const systemPrompt = await loadPrompt('program-score-coverage');

  const competencyContext = input.competencies.map(c => ({
    id: c.id,
    name: c.name,
    know_descriptor: c.knowDescriptor,
    understand_descriptor: c.understandDescriptor,
    do_descriptor: c.doDescriptor,
  }));

  const userMessage = [
    `**Snapshot ID:** ${input.snapshotId}`,
    `**Course:** ${input.courseCode}`,
    '',
    '**Snapshot profile:**',
    JSON.stringify(input.snapshotProfile, null, 2),
    '',
    '---',
    '',
    '**Competencies to score:**',
    JSON.stringify(competencyContext, null, 2),
    '',
    '---',
    '',
    'Score every competency above against this snapshot per the system',
    'instructions. Produce one cell entry per competency, using the',
    'competency.id verbatim. Set snapshot_id to the value above and',
    'generated_at to the current ISO timestamp.',
  ].join('\n');

  const result = await provider.complete<ProgramCoverageResult>({
    systemPrompt,
    userMessage,
    schemaName: 'program_coverage_v2',
    jsonSchema: coverageJsonSchema as unknown as object,
    validate: (raw: unknown) => coverageResultSchema.parse(raw),
  });

  // Unknown ids dropped: a cell for a competency id that wasn't in the
  // input is never returned (replaces P0a Ruling 10's per-target member
  // filter, which no longer applies now that scoring carries no target).
  const knownIds = new Set(input.competencies.map(c => c.id));
  const cells = result.data.cells.filter(cell => knownIds.has(cell.competency_id));

  return {
    result: { ...result.data, cells },
    model: provider.model,
    costUsdCents: result.costUsdCents,
  };
}
