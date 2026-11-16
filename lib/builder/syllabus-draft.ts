// A course drafted from its syllabus (spec 2026-11-16-map-course-edits-and-required-skills-design.md §4b). A free campus
// model reads the syllabus and drafts objectives, developed and required skills, and the prerequisites it names; the
// draft lands on the map as ordinary map edits (origin 'syllabus'). A syllabus states intentions, so every level is a
// goal, never evidence. Server-only (reads the depth scale from disk).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { CampusProvider, campusReasoningParams } from '@/lib/ai/campus';
import { BLOOM, type CourseEdits, type Depth, type Link, type ObjectiveEdit, type SkillEdit } from './types';

export const SYLLABUS_TEXT_MIN = 300;
export const SYLLABUS_TEXT_MAX = 60_000;
/** The Do level a drafted skill may reach when the syllabus states no condition for it. */
export const DO_CAP_NO_CONDITION = 2;
const MAX = { objectives: 12, developed: 15, required: 10, prerequisites: 12 } as const;

// OpenAI-strict-safe: every property required, optional values nullable.
const level = z.number().int().min(0).max(5).nullable();
const statement = z.string().trim().min(1).max(600);
export const syllabusDraftSchema = z.object({
  objectives: z.array(z.object({ text: statement, bloom: z.enum(BLOOM) })).max(MAX.objectives),
  developed: z.array(z.object({ statement, k: level, u: level, d: level, condition_missing: z.boolean() })).max(MAX.developed),
  required: z.array(z.object({ statement, k: level, u: level, d: level })).max(MAX.required),
  prerequisites: z.array(z.object({ code: z.string().max(40), kind: z.enum(['prereq', 'coreq']) })).max(MAX.prerequisites),
});
export type SyllabusDraft = z.infer<typeof syllabusDraftSchema>;

/**
 * Validates a model reply. Lists longer than allowed keep their first items rather than failing the import; a level the
 * model left out reads as null, and a missing condition_missing flag is set when Do is above 2 (so the cap applies).
 */
export function parseSyllabusDraft(raw: unknown): SyllabusDraft {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const clip = (k: keyof typeof MAX) => (Array.isArray(o[k]) ? (o[k] as unknown[]).slice(0, MAX[k]) : o[k] ?? []);
  const levels = (x: unknown) => {
    if (!x || typeof x !== 'object') return x;
    const r = x as Record<string, unknown>;
    return { ...r, k: r.k ?? null, u: r.u ?? null, d: r.d ?? null };
  };
  const developed = clip('developed');
  return syllabusDraftSchema.parse({
    objectives: clip('objectives'),
    developed: Array.isArray(developed) ? developed.map(x => {
      const r = levels(x) as Record<string, unknown>;
      return r && typeof r === 'object' && typeof r.condition_missing !== 'boolean' ? { ...r, condition_missing: typeof r.d === 'number' && r.d > DO_CAP_NO_CONDITION } : r;
    }) : developed,
    required: Array.isArray(o.required) ? (clip('required') as unknown[]).map(levels) : clip('required'),
    prerequisites: clip('prerequisites'),
  });
}

/** "gc1040" / "GC-1040" → "GC 1040"; null when the text is not a course code. */
export function normalizeCourseCode(raw: string): string | null {
  const m = /^\s*([A-Za-z]{2,5})\s*[- ]?\s*(\d{4}[A-Za-z]{0,3})\s*$/.exec(raw);
  return m ? `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}` : null;
}

let depthScale: string | null = null;
const readDepthScale = () => (depthScale ??= readFileSync(join(process.cwd(), 'lib/ai/prompts/shared/depth-scale.md'), 'utf-8').trim());

export const FOUNDATIONAL = ['Agency', 'Attention to Detail', 'Resilience', 'Curiosity', 'Written Communication', 'Spoken Communication'];

export function buildSyllabusPrompt(text: string, course: { code: string; title: string }): string {
  return `You draft a course's map entry from its syllabus, for a curriculum map of the Clemson Department of Graphic Communications.

Course: ${course.code} ${course.title}

The depth scale every level uses:

${readDepthScale()}

---

How to apply it here. A syllabus states what the course intends; it is never evidence of what students attain. So:

1. Every level you give is a GOAL read from the syllabus's stated intentions (objectives, assignments, projects, assessments as described), never evidence. The evidence rule above does not apply to a draft because nothing here is a claim of attainment; a capture of the course later checks these goals against evidence. A Know level above 1, or an Understand or Do level above 0, is a goal only.
2. Do above 2 only when the syllabus states the condition: that students perform independently, in unfamiliar or new conditions, under constraints, or guide others. If the syllabus states no such condition for a developed skill, give it at most 2 for Do and set "condition_missing": true. Set "condition_missing": false only when the stated condition supports the Do level you give.
3. Foundational competencies (${FOUNDATIONAL.join(', ')}) are scored on Do only: their k and u are null, never 0.
4. Objectives: the course's learning objectives, each with exactly one Bloom process (Remember, Understand, Apply, Analyze, Evaluate, Create). An objective with two verbs of different processes ("perform testing and analyze X", "explain and design X") becomes two objectives, one Bloom process each. At most ${MAX.objectives}.
5. Developed skills ("developed"): what students should be able to do after the course, one activity per statement, written as a skill (an action and its object, e.g. "Prepare a print-ready PDF with correct bleed"), with K/U/D goals. Use null for a dimension the course does not address. A foundational competency appears only when the syllabus gives grounds for it, and its statement says what students do (e.g. "Attention to Detail: check proofs against the job ticket before release"), never the bare name. At most ${MAX.developed}.
6. Required skills ("required"): what students must bring in on arrival, as the syllabus states or plainly assumes (from its prerequisites, "students should already…", tools it expects to be known). Same statement style, with the K/U/D level needed on arrival. At most ${MAX.required}; an empty list is fine.
7. Prerequisites: list only the courses the syllabus names as prerequisites or corequisites, copying each code from the syllabus as subject letters, a space, and the number. "kind" is "coreq" for a corequisite or a course that may be taken at the same time, otherwise "prereq". Never add a course the syllabus does not name; a class standing ("Junior level") or "none" is not a course, so the list is then empty.

Before replying, check: every objective has one verb and one Bloom process; every developed skill with Do above 2 has a condition the syllabus states, otherwise Do is at most 2 and condition_missing is true; foundational skills have k and u null; every prerequisite code appears in the syllabus text. Every developed item has all of statement, k, u, d and condition_missing; every required item has statement, k, u and d.

Reply with JSON only.

Syllabus:
"""
${text}
"""`;
}

/** The JSON schema the model is asked to follow (json_object mode). */
export const syllabusJsonSchema = (): object => z.toJSONSchema(syllabusDraftSchema) as object;

const key = (s: string) => normalizeStatement(s).replace(/[.;:,\s]+$/, '');

/**
 * The draft as map edits: every item an `add` with origin 'syllabus', stamped with who and when. The Do cap is
 * enforced again here: a developed skill flagged condition_missing never goes above D2, whatever the model said.
 * A repeated statement is kept once.
 */
export function toCourseEdits(draft: SyllabusDraft, meta: { by: string; at: string; draftId: string; fileName: string }): CourseEdits {
  let n = 0;
  const base = (kind: string) => ({ id: `syl:${meta.draftId.slice(0, 8)}:${kind}${n++}`, by: meta.by, at: meta.at, origin: 'syllabus' as const });
  const once = <T,>(list: T[], text: (t: T) => string): T[] => {
    const seen = new Set<string>();
    return list.filter(x => { const k = key(text(x)); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  };
  const objectives: ObjectiveEdit[] = once(draft.objectives, o => o.text)
    .map(o => ({ ...base('o'), action: 'add', target: null, text: o.text, bloom: o.bloom }));
  const required: SkillEdit[] = once(draft.required, r => r.statement)
    .map(r => ({ ...base('r'), action: 'add', target: null, statement: r.statement, levels: { k: r.k, u: r.u, d: r.d } }));
  const developed: SkillEdit[] = once(draft.developed, s => s.statement).map(s => {
    const levels: Depth = { k: s.k, u: s.u, d: s.condition_missing && s.d != null ? Math.min(s.d, DO_CAP_NO_CONDITION) : s.d };
    return { ...base('d'), action: 'add', target: null, statement: s.statement, levels, ...(s.condition_missing ? { conditionMissing: true } : {}) };
  });
  return { objectives, required, developed, source: { kind: 'syllabus', draftId: meta.draftId, fileName: meta.fileName, at: meta.at } };
}

/**
 * The prerequisites the syllabus names, as plan links into the course. `refOf` maps a normalized code to the plan's
 * ref for that course (a proposed course's id), or returns the code. Codes that do not read as course codes, and the
 * course itself, are dropped.
 */
export function prereqLinks(draft: SyllabusDraft, course: { ref: string; code: string }, refOf: (code: string) => string): Link[] {
  const out: Link[] = [];
  const self = normalizeCourseCode(course.code) ?? course.code;
  for (const p of draft.prerequisites) {
    const code = normalizeCourseCode(p.code);
    if (!code || code === self) continue;
    const from = refOf(code);
    if (from === course.ref || out.some(l => l.from === from)) continue;
    out.push(p.kind === 'coreq' ? { from, to: course.ref, kind: 'coreq' } : { from, to: course.ref });
  }
  return out;
}

/** The campus model the draft uses (free); null when the campus endpoint is not configured. Never a paid provider. */
export function syllabusModel(): { model: string; baseURL: string; apiKey: string } | null {
  const baseURL = process.env.CAMPUS_LLM_BASE_URL?.trim(), apiKey = process.env.CAMPUS_LLM_API_KEY?.trim();
  const model = process.env.CAMPUS_LLM_DEFAULT_MODEL?.trim();
  return baseURL && apiKey && model ? { model, baseURL, apiKey } : null;
}

/** One campus call (JSON mode), validated. Throws when the campus model is not configured, fails, or replies off-schema. */
export async function draftSyllabus(text: string, course: { code: string; title: string }): Promise<{ draft: SyllabusDraft; model: string }> {
  const cfg = syllabusModel();
  if (!cfg) throw new Error('The campus model is not configured.');
  // Thinking off where the model has a switch: with it on, qwen3.6 ran to the 8000-token cap on a 10k-character syllabus.
  let off: { reasoning: 'off' } | undefined = { reasoning: 'off' };
  try { campusReasoningParams(cfg.model, 'off'); } catch { off = undefined; }
  const provider = new CampusProvider(cfg.model, cfg.baseURL, cfg.apiKey, off);
  const { data } = await provider.complete({
    systemPrompt: 'You read course syllabi and draft curriculum-map entries as JSON. Follow the rules in the user message exactly.',
    userMessage: buildSyllabusPrompt(text.slice(0, SYLLABUS_TEXT_MAX), course),
    schemaName: 'syllabus_draft', jsonSchema: syllabusJsonSchema(), validate: parseSyllabusDraft,
  });
  return { draft: data, model: cfg.model };
}
