import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const SeededEdge = z.object({
  prereq_course_code: z.string().min(1),
  sub_competency_id: z.string().min(1),
  expected_k: z.number().int().min(0).max(5).nullable(),
  expected_u: z.number().int().min(0).max(5).nullable(),
  expected_d: z.number().int().min(0).max(5).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  rationale: z.string().min(1).max(600),
});

export const SeededEdges = z.object({
  edges: z.array(SeededEdge),
});

export type SeededEdgesType = z.infer<typeof SeededEdges>;
export type SeededEdgeItem = z.infer<typeof SeededEdge>;

// ---------------------------------------------------------------------------
// Strict-mode JSON Schema
//
// OpenAI strict structured-output requires every property in `properties` to
// be listed in `required`. Nullable integer dims are typed as
// `{ "type": ["integer", "null"], "minimum": 0, "maximum": 5 }`.
// `additionalProperties: false` on every object node (including items).
// ---------------------------------------------------------------------------

export const seededEdgesJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['edges'],
  properties: {
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'prereq_course_code',
          'sub_competency_id',
          'expected_k',
          'expected_u',
          'expected_d',
          'confidence',
          'rationale',
        ],
        properties: {
          prereq_course_code: { type: 'string', minLength: 1 },
          sub_competency_id: { type: 'string', minLength: 1 },
          expected_k: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          expected_u: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          expected_d: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          rationale: { type: 'string', minLength: 1, maxLength: 600 },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface IncomingExpectation {
  statement: string;
  expected_depth: {
    k: number | null;
    u: number | null;
    d: number | null;
  };
}

export interface SubCompetencyInput {
  id: string;
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
}

export interface SeedPrereqEdgesInput {
  focalCourseCode: string;
  prerequisitesText: string;
  incomingExpectations: IncomingExpectation[];
  subCompetencies: SubCompetencyInput[];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Calls the prereq-edge-seed AI function. Given the focal course's free-text
 * prerequisites, its incoming-expectation statements, and the sub-competency
 * catalog, proposes direct skill-tagged prerequisite edges.
 *
 * The caller (Task 6 route) is responsible for:
 *   1. Validating each `prereq_course_code` against `courses.code`.
 *   2. Mapping matched edges to `SeedEdgeInput` and calling `upsertSeededEdges`.
 *   3. Reporting unmatched codes as `unknownPrereqs`.
 */
export async function seedPrereqEdges(input: SeedPrereqEdgesInput): Promise<{
  edges: SeededEdgeItem[];
  model: string;
  costUsdCents: number;
  durationMs: number;
}> {
  const [provider, systemPrompt] = await Promise.all([
    getProviderForFunction('prereq-edge-seed'),
    loadPrompt('prereq-edge-seed'),
  ]);

  // Build a readable sub-competency catalog listing with ids (so the model can
  // emit the join key). Format: `- [<id>] <name>\n  K: …\n  U: …\n  D: …`
  const catalogSection = input.subCompetencies.length > 0
    ? input.subCompetencies.map(sc =>
        `- [${sc.id}] ${sc.name}\n  K: ${sc.knowDescriptor}\n  U: ${sc.understandDescriptor}\n  D: ${sc.doDescriptor}`
      ).join('\n')
    : '(none)';

  // Build an incoming-expectations listing.
  const expectationsSection = input.incomingExpectations.length > 0
    ? input.incomingExpectations.map((e, i) => {
        const k = e.expected_depth.k ?? 'null';
        const u = e.expected_depth.u ?? 'null';
        const d = e.expected_depth.d ?? 'null';
        return `E${i + 1}. [K${k} U${u} D${d}] ${e.statement}`;
      }).join('\n')
    : '(none)';

  const userMessage = `# Focal course: ${input.focalCourseCode}

## Prerequisites prose (catalog field)

${input.prerequisitesText.trim() || '(empty)'}

## Incoming-expectation statements

${expectationsSection}

## Sub-competency catalog

${catalogSection}`;

  const result = await provider.complete<SeededEdgesType>({
    systemPrompt,
    userMessage,
    schemaName: 'seeded_edges',
    jsonSchema: seededEdgesJsonSchema as unknown as object,
    validate: (raw: unknown) => SeededEdges.parse(raw),
  });

  return {
    edges: result.data.edges,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
