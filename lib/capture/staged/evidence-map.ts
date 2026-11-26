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
// assumedSkills: the stage-4 card asks about every assumed skill and the stage-4 skill names every one, so the
// map holds at most 12 (final-review 5): one limit, enforced on the model's map (clamp) and the instructor's PUT.
/** A `source` that names a whole material (its digest), not a chunk: `material:<material id>` (Task 9c). Never a
 *  citable chunk id: the chunk viewer and revision provenance resolve chunk ids only. */
export const MATERIAL_SOURCE_PREFIX = 'material:';
export const isMaterialSource = (source: string): boolean => source.startsWith(MATERIAL_SOURCE_PREFIX);

export const EVIDENCE_MAP_LIMITS = { string: 2000, list: 60, sublist: 40, assumedSkills: 12 } as const;
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
  assumed_skills: z.array(z.object({ skill: S, used_in: S, source: S })).max(EVIDENCE_MAP_LIMITS.assumedSkills),
  objectives: list(z.object({
    text: S,
    status: z.enum(['graded_work_found', 'not_found']),
    graded_work: sublist(S),
  })),
  conflicts: sublist(S),
  unreadable: sublist(z.object({ file: S, note: S })),
}) satisfies z.ZodType<EvidenceMap>;

/**
 * For the MODEL's output only (the instructor's PUT is rejected, not clamped): cut strings and lists to the
 * limits so one long item does not discard a paid read. Returns what changed so the caller can log it.
 */
export function clampEvidenceMap(raw: unknown): { value: unknown; clamped: number } {
  let clamped = 0;
  const { string: maxStr, list: maxList, sublist: maxSub } = EVIDENCE_MAP_LIMITS;
  const walk = (v: unknown, listMax: number): unknown => {
    if (typeof v === 'string') {
      if (v.length <= maxStr) return v;
      clamped++;
      return v.slice(0, maxStr - 1) + '…';
    }
    if (Array.isArray(v)) {
      if (v.length > listMax) clamped++;
      return v.slice(0, listMax).map(x => walk(x, maxSub));
    }
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, maxSub)]));
    return v;
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: raw, clamped: 0 };
  const topList = new Set(['graded_work', 'tests', 'competencies', 'objectives']);
  const topMax = (k: string) => (k === 'assumed_skills' ? EVIDENCE_MAP_LIMITS.assumedSkills : topList.has(k) ? maxList : maxSub);
  const value = Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, walk(x, topMax(k))]));
  return { value, clamped };
}

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
