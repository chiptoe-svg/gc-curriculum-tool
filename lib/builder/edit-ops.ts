// Recording map edits on a course. Pure. Edits collapse per item: a second change to an item replaces the first
// (same `target`), so effectiveCourse never sees two edits of one item; taking out an item added on the map
// deletes its add rather than recording a remove.
import type { BloomProcess, CourseEdits, Depth, EditBase, ObjectiveEdit, PlanState, SkillEdit } from './types';

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
