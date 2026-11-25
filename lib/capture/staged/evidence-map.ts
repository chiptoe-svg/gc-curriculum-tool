import { z } from 'zod';

/** The pre-read of a course's materials that the staged interview starts from. Pure types + schemas. */
export type EvidenceMap = {
  summary: string;
  graded_work: Array<{ title: string; weight: string | null; deliverables: string | null; rubric_criteria: string[]; source: string }>;
  tests: Array<{ name: string; item_types: string[]; source: string }>;
  competencies: Array<{ statement: string; graded_work: string[] }>;
  assumed_skills: Array<{ skill: string; used_in: string; source: string }>;
  objectives: Array<{ text: string; status: 'graded_work_found' | 'not_found'; graded_work: string[] }>;
  conflicts: string[];
  unreadable: Array<{ file: string; note: string }>;
};

export const EvidenceMapSchema = z.object({
  summary: z.string(),
  graded_work: z.array(z.object({
    title: z.string(),
    weight: z.string().nullable(),
    deliverables: z.string().nullable(),
    rubric_criteria: z.array(z.string()),
    source: z.string(),
  })),
  tests: z.array(z.object({ name: z.string(), item_types: z.array(z.string()), source: z.string() })),
  competencies: z.array(z.object({ statement: z.string(), graded_work: z.array(z.string()) })),
  assumed_skills: z.array(z.object({ skill: z.string(), used_in: z.string(), source: z.string() })),
  objectives: z.array(z.object({
    text: z.string(),
    status: z.enum(['graded_work_found', 'not_found']),
    graded_work: z.array(z.string()),
  })),
  conflicts: z.array(z.string()),
  unreadable: z.array(z.object({ file: z.string(), note: z.string() })),
}) satisfies z.ZodType<EvidenceMap>;

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** OpenAI strict: every property is required; optional values are nullable unions. */
export const EvidenceMapJsonSchema = obj({
  summary: str,
  graded_work: { type: 'array', items: obj({ title: str, weight: nullableStr, deliverables: nullableStr, rubric_criteria: strArr, source: str }) },
  tests: { type: 'array', items: obj({ name: str, item_types: strArr, source: str }) },
  competencies: { type: 'array', items: obj({ statement: str, graded_work: strArr }) },
  assumed_skills: { type: 'array', items: obj({ skill: str, used_in: str, source: str }) },
  objectives: { type: 'array', items: obj({ text: str, status: { type: 'string', enum: ['graded_work_found', 'not_found'] }, graded_work: strArr }) },
  conflicts: strArr,
  unreadable: { type: 'array', items: obj({ file: str, note: str }) },
});
