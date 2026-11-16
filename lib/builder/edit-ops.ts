// Recording map edits on a course. Pure. Edits collapse per item: a second change to an item replaces the first
// (same `target`), so effectiveCourse never sees two edits of one item; taking out an item added on the map
// deletes its add rather than recording a remove.
import { normalizeStatement } from '@/lib/catalog/project-trail';
import type { BloomProcess, CourseEdits, Depth, EditBase, Link, ObjectiveEdit, PlanState, SkillEdit } from './types';

export const NO_EDITS: CourseEdits = { objectives: [], required: [], developed: [] };

export const editsOf = (plan: PlanState, ref: string): CourseEdits => plan.courseEdits?.[ref] ?? NO_EDITS;

/** The plan with one course's edits replaced; a course left with no edits is dropped from courseEdits. */
export function withEdits(plan: PlanState, ref: string, fn: (e: CourseEdits) => CourseEdits): PlanState {
  const next = fn(editsOf(plan, ref));
  const all = { ...(plan.courseEdits ?? {}) };
  if (next.objectives.length + next.required.length + next.developed.length === 0) delete all[ref];
  else all[ref] = next;
  return { ...plan, courseEdits: all };
}

/** A skill as the map shows it (effectiveCourse): `ref` is the required ref or the developed skillRef. */
export interface SkillItem { ref: string; statement: string; draft: boolean }

/** The edit that produced a draft skill item (an add or an edit), matched on its statement as written. */
const sourceOf = <E extends { action: string; statement?: string | null; text?: string | null }>(list: E[], value: string): E | undefined =>
  [...list].reverse().find(e => e.action !== 'remove' && (e.statement ?? e.text) === value);

/** Save a skill: `item` null adds one; otherwise the item's edit is replaced (or a first edit of a captured skill recorded). */
export function saveSkill(list: SkillEdit[], item: SkillItem | null, statement: string, levels: Depth, stamp: EditBase): SkillEdit[] {
  if (!item) return [...list, { ...stamp, action: 'add', target: null, statement, levels }];
  const src = item.draft ? sourceOf(list, item.statement) : undefined;
  if (src?.action === 'add') return list.map(e => (e === src ? { ...stamp, action: 'add', target: null, statement, levels } : e));
  const target = src ? src.target : item.ref;
  return [...list.filter(e => e.target !== target), { ...stamp, action: 'edit', target, statement, levels }];
}

/** Take a skill off this course on the map. */
export function removeSkill(list: SkillEdit[], item: SkillItem, stamp: EditBase): SkillEdit[] {
  const src = item.draft ? sourceOf(list, item.statement) : undefined;
  if (src?.action === 'add') return list.filter(e => e !== src);
  const target = src ? src.target : item.ref;
  return [...list.filter(e => e.target !== target), { ...stamp, action: 'remove', target, statement: null, levels: null }];
}

export interface ObjectiveItem { text: string; draft: boolean }

export function saveObjective(list: ObjectiveEdit[], item: ObjectiveItem | null, text: string, bloom: BloomProcess | null, stamp: EditBase): ObjectiveEdit[] {
  if (!item) return [...list, { ...stamp, action: 'add', target: null, text, bloom }];
  const src = item.draft ? sourceOf(list, item.text) : undefined;
  if (src?.action === 'add') return list.map(e => (e === src ? { ...stamp, action: 'add', target: null, text, bloom } : e));
  const target = src ? src.target : item.text;
  return [...list.filter(e => e.target !== target), { ...stamp, action: 'edit', target, text, bloom }];
}

export function removeObjective(list: ObjectiveEdit[], item: ObjectiveItem, stamp: EditBase): ObjectiveEdit[] {
  const src = item.draft ? sourceOf(list, item.text) : undefined;
  if (src?.action === 'add') return list.filter(e => e !== src);
  const target = src ? src.target : item.text;
  return [...list.filter(e => e.target !== target), { ...stamp, action: 'remove', target, text: null, bloom: null }];
}

const same = (s: string) => normalizeStatement(s).replace(/[.;:,\s]+$/, '');

/**
 * A syllabus draft merged into the plan (spec §4b): each drafted item is appended as its own `add` edit (origin
 * 'syllabus'), except one whose text the course already shows (`existing`, the course as the map reads it);
 * the course's edits record the source; links the plan or the catalog already has are not repeated.
 */
export function mergeSyllabusDraft(
  plan: PlanState, ref: string, draft: { edits: CourseEdits; links: Link[] },
  existing: { objectives: string[]; required: string[]; developed: string[] }, catalogLinks: Array<{ from: string; to: string }>,
): PlanState {
  const fresh = <E,>(list: E[], have: string[], text: (e: E) => string | null) => {
    const seen = new Set(have.map(same));
    return list.filter(e => { const t = text(e); if (!t || seen.has(same(t))) return false; seen.add(same(t)); return true; });
  };
  const next = withEdits(plan, ref, e => ({
    objectives: [...e.objectives, ...fresh(draft.edits.objectives, existing.objectives, x => x.text)],
    required: [...e.required, ...fresh(draft.edits.required, existing.required, x => x.statement)],
    developed: [...e.developed, ...fresh(draft.edits.developed, existing.developed, x => x.statement)],
    ...(draft.edits.source ? { source: draft.edits.source } : e.source ? { source: e.source } : {}),
  }));
  const has = (l: Link) => l.from === ref || next.links.some(x => x.from === l.from && x.to === l.to)
    || catalogLinks.some(x => x.from === l.from && x.to === l.to);
  const links = draft.links.filter(l => l.to === ref && !has(l));
  return links.length ? { ...next, links: [...next.links, ...links] } : next;
}
