import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const IntendedSkillItem = z.object({
  sub_competency_id: z.string().min(1),
  intended_k: z.number().int().min(0).max(5).nullable(),
  intended_u: z.number().int().min(0).max(5).nullable(),
  intended_d: z.number().int().min(0).max(5).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  rationale: z.string().min(1).max(600),
});

export const IntendedSkills = z.object({
  items: z.array(IntendedSkillItem),
});

export type IntendedSkillsType = z.infer<typeof IntendedSkills>;
export type IntendedSkillItemType = z.infer<typeof IntendedSkillItem>;

// ---------------------------------------------------------------------------
// Strict-mode JSON Schema
//
// OpenAI strict structured-output requires every property in `properties` to
// be listed in `required`. Nullable integer dims are typed as
// `{ "type": ["integer", "null"], "minimum": 0, "maximum": 5 }`.
// `additionalProperties: false` on every object node (including items).
// ---------------------------------------------------------------------------

export const intendedSkillsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sub_competency_id',
          'intended_k',
          'intended_u',
          'intended_d',
          'confidence',
          'rationale',
        ],
        properties: {
          sub_competency_id: { type: 'string', minLength: 1 },
          intended_k: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          intended_u: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
          intended_d: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
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

export interface CatalogInput {
  description: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

export interface SubCompetencyInput {
  id: string;
  name: string;
  knowDescriptor: string;
  understandDescriptor: string;
  doDescriptor: string;
}

export interface ExtractIntendedSkillsInput {
  courseCode: string;
  catalog: CatalogInput;
  subCompetencies: SubCompetencyInput[];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Calls the intended-skills-extract AI function. Given a course's catalog
 * text and the sub-competency catalog, emits the INTENDED (syllabus-asserted,
 * NOT verified-attainment) K/U/D depth per sub-competency the catalog implies.
 *
 * The caller is responsible for:
 *   1. Validating each `sub_competency_id` against the canonical catalog.
 *   2. Mapping items to `CourseIntendedSkillUpsert` and calling the DB upsert.
 *   3. Reporting unmatched ids as unknown.
 */
export async function extractIntendedSkills(input: ExtractIntendedSkillsInput): Promise<{
  items: IntendedSkillItemType[];
  model: string;
  costUsdCents: number;
  durationMs: number;
}> {
  const [provider, systemPrompt] = await Promise.all([
    getProviderForFunction('intended-skills-extract'),
    loadPrompt('intended-skills-extract'),
  ]);

  // Build a readable sub-competency catalog listing with ids (so the model
  // can emit the join key). Format: `- [<id>] <name>\n  K: …\n  U: …\n  D: …`
  const catalogSection = input.subCompetencies.length > 0
    ? input.subCompetencies.map(sc =>
        `- [${sc.id}] ${sc.name}\n  K: ${sc.knowDescriptor}\n  U: ${sc.understandDescriptor}\n  D: ${sc.doDescriptor}`
      ).join('\n')
    : '(none)';

  // Build catalog text sections.
  const description = input.catalog.description.trim() || '(empty)';

  const objectives = input.catalog.learningObjectives.length > 0
    ? input.catalog.learningObjectives.map((o, i) => `${i + 1}. ${o}`).join('\n')
    : '(none)';

  const projects = input.catalog.majorProjects.length > 0
    ? input.catalog.majorProjects.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : '(none)';

  const skillsRequired = input.catalog.skillsRequired.length > 0
    ? input.catalog.skillsRequired.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '(none)';

  const userMessage = `# Course: ${input.courseCode}

## Catalog description

${description}

## Learning objectives

${objectives}

## Major projects

${projects}

## Skills required

${skillsRequired}

## Sub-competency catalog

${catalogSection}`;

  const result = await provider.complete<IntendedSkillsType>({
    systemPrompt,
    userMessage,
    schemaName: 'intended_skills',
    jsonSchema: intendedSkillsJsonSchema as unknown as object,
    validate: (raw: unknown) => IntendedSkills.parse(raw),
  });

  return {
    items: result.data.items,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
