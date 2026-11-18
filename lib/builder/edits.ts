// A course as the map reads it: the captured (or proposed) course with this plan's edits laid over it.
// Edits never change a capture; an edited item is a new item (new ref, draft) so judgments and decisions
// about the old wording do not carry over.
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type {
  BloomProcess, CourseEdits, Depth, LibraryCourse, LibraryVersion, Link, ProposedCourse, RequiredSkill, Skill,
} from './types';
import { proposeBloom } from './bloom';

const hash = (s: string) => textHash(normalizeStatement(s));
const NONE: Depth = { k: null, u: null, d: null };

export interface EffectiveCourse {
  objectives: Array<{ text: string; bloom: BloomProcess | null; draft: boolean }>;
  required: Array<RequiredSkill & { draft: boolean }>;
  developed: Array<Skill & { draft: boolean }>;
}

export function effectiveCourse(
  lc: LibraryCourse | ProposedCourse, version: LibraryVersion | null, edits: CourseEdits | undefined,
): EffectiveCourse {
  // Objectives
  let objectives: EffectiveCourse['objectives'] = (version?.objectives ?? lc.objectives).map(text => ({ text, bloom: proposeBloom(text), draft: false }));
  for (const e of edits?.objectives ?? []) {
    if (e.action === 'remove') objectives = objectives.filter(o => o.text !== e.target);
    else if (e.action === 'edit') {
      objectives = objectives.map(o => o.text === e.target && e.text
        ? { text: e.text, bloom: e.bloom ?? proposeBloom(e.text), draft: true } : o);
    } else if (e.text) objectives.push({ text: e.text, bloom: e.bloom ?? proposeBloom(e.text), draft: true });
  }
  // Required and developed skills
  let required: EffectiveCourse['required'] = (version?.required ?? []).map(r => ({ ...r, draft: false }));
  for (const e of edits?.required ?? []) {
    if (e.action === 'remove') required = required.filter(r => r.ref !== e.target);
    else if (e.action === 'edit') {
      required = required.map(r => r.ref === e.target && e.statement
        ? { ref: hash(e.statement), statement: e.statement, need: e.levels ?? r.need, draft: true } : r);
    } else if (e.statement) required.push({ ref: hash(e.statement), statement: e.statement, need: e.levels ?? NONE, draft: true });
  }
  let developed: EffectiveCourse['developed'] = (version?.skills ?? []).map(s => ({ ...s, draft: false }));
  for (const e of edits?.developed ?? []) {
    if (e.action === 'remove') developed = developed.filter(s => s.skillRef !== e.target);
    else if (e.action === 'edit') {
      developed = developed.map(s => s.skillRef === e.target && e.statement
        ? { skillRef: hash(e.statement), statement: e.statement, k: e.levels?.k ?? s.k, u: e.levels?.u ?? s.u, d: e.levels?.d ?? s.d, draft: true } : s);
    } else if (e.statement) {
      developed.push({ skillRef: hash(e.statement), statement: e.statement, k: e.levels?.k ?? null, u: e.levels?.u ?? null, d: e.levels?.d ?? null, draft: true });
    }
  }
  return { objectives, required, developed };
}

/** How many map changes touch a course: its edits plus the plan's links and set-aside prerequisites naming it. */
export function changeCount(edits: CourseEdits | undefined, links: Link[], unlinked: Link[], ref: string): number {
  const own = edits ? edits.objectives.length + edits.required.length + edits.developed.length : 0;
  const named = (l: Link) => l.from === ref || l.to === ref;
  return own + links.filter(named).length + unlinked.filter(named).length;
}
