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

// Size limits are zod-only (applied to the instructor's PUT and to the model's output). They are NOT in
// EvidenceMapJsonSchema: whether OpenAI strict mode accepts maxLength/maxItems is unverified here.
export const EVIDENCE_MAP_LIMITS = { string: 2000, list: 60, sublist: 40 } as const;
const S = z.string().max(EVIDENCE_MAP_LIMITS.string);
const list = <T extends z.ZodType>(t: T) => z.array(t).max(EVIDENCE_MAP_LIMITS.list);
const sublist = <T extends z.ZodType>(t: T) => z.array(t).max(EVIDENCE_MAP_LIMITS.sublist);

export const EvidenceMapSchema = z.object({
  summary: S,
  graded_work: list(z.object({
    title: S,
    weight: S.nullable(),
    deliverables: S.nullable(),
    rubric_criteria: sublist(S),
    source: S,
  })),
  tests: list(z.object({ name: S, item_types: sublist(S), source: S })),
  competencies: list(z.object({ statement: S, graded_work: sublist(S) })),
  assumed_skills: list(z.object({ skill: S, used_in: S, source: S })),
  objectives: list(z.object({
    text: S,
    status: z.enum(['graded_work_found', 'not_found']),
    graded_work: sublist(S),
  })),
  conflicts: sublist(S),
  unreadable: sublist(z.object({ file: S, note: S })),
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
