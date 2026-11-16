// Markdown export of a map's changes: what faculty download to review or carry into capture. Pure.
// Every map edit is a draft; the renderer marks drafts with a trailing `*` and escapes user text so a skill
// statement cannot break the layout (a user's own asterisk is escaped, so only the renderer's `*` is bare).
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { effectiveCourse } from './edits';
import { placeCourses, type PlacedCourse, versionOf } from './compute';
import type { requiredByCourse, ReqResult, ReqStatus } from './threads';
import type { Depth, Library, LibraryCourse, MatchDecision, PlanState, ProposedCourse, ObjectiveEdit, SkillEdit } from './types';

/** Escapes Markdown control characters and flattens line breaks. */
export function esc(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').replace(/[\\*_`[\]<>]/g, m => `\\${m}`);
}

const hash = (t: string) => textHash(normalizeStatement(t));
const NY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
/** The local (Clemson) date of an ISO time, like the export header; a malformed value falls back to its first ten characters. */
const day = (iso: string) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? iso.slice(0, 10) : NY_DATE.format(t); };
const DRAFT = '*';
const levels = (d: Depth | null) => d ? ` (K${d.k ?? '–'} U${d.u ?? '–'} D${d.d ?? '–'})` : '';
const stamp = (e: { by: string; at: string }) => ` (${esc(e.by)}, ${day(e.at)})`;
const LABEL: Record<MatchDecision['label'], string> = { fully: 'Accepted fully', partly: 'Partly', not: 'Rejected' };
const STATUS: Record<ReqStatus, string> = { met: 'Met', met_draft: 'Met*', partly: 'Partly met', not: 'Not met' };
const NAMED: Record<'added' | 'changed' | 'removed', string> = { added: 'Added', changed: 'Changed', removed: 'Removed' };
const KIND = { add: 'added', edit: 'changed', remove: 'removed' } as const;

export interface ChangesInput {
  planName: string;
  catalogYear: string | null;
  exportedBy: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  lib: Library;
  plan: PlanState;
  required: ReturnType<typeof requiredByCourse>;
  /** Draft decisions for this plan plus the non-draft ones the library holds. */
  decisions: MatchDecision[];
  /** Syllabus-drafted courses by ref: the file and date it was drafted from. Absent = read from courseEdits[ref].source. */
  syllabusDrafts?: Record<string, { file: string; date: string }>;
}

function statusLine(r: ReqResult): string {
  let s = STATUS[r.status];
  if (r.status === 'partly' && r.faded.length) s += `, faded: ${r.faded.map(d => d.toUpperCase()).join('/')}`;
  if (r.status === 'partly' && r.short.length) s += `, short: ${r.short.map(d => d.toUpperCase()).join('/')}`;
  return r.supplier ? `${s}, from ${esc(r.supplier.course)}: "${esc(r.supplier.statement)}"` : s;
}

export function renderChangesMarkdown(input: ChangesInput): string {
  const { lib, plan, required, decisions } = input;
  const byCode = new Map<string, LibraryCourse>(lib.courses.map(c => [c.code, c]));
  const proposed = new Map<string, ProposedCourse>(plan.proposed.map(p => [p.id, p]));
  const placed = placeCourses(lib, plan).filter(c => !c.requirement);
  const placedByRef = new Map<string, PlacedCourse>(placed.map(c => [c.ref, c]));
  const codeOf = (ref: string) => placedByRef.get(ref)?.code ?? proposed.get(ref)?.code ?? ref;
  const titleOf = (ref: string) => byCode.get(ref)?.title ?? proposed.get(ref)?.title ?? '';

  const eff = (ref: string) => {
    const lc = byCode.get(ref) ?? proposed.get(ref);
    if (!lc) return null;
    const version = byCode.has(ref) ? versionOf(lc as LibraryCourse, plan) : null;
    return { lc, version, e: effectiveCourse(lc, version, plan.courseEdits?.[ref]) };
  };

  // Courses with a change, in code order.
  const named = (l: { from: string; to: string }, ref: string) => l.from === ref || l.to === ref;
  const refs = new Set<string>(Object.entries(plan.courseEdits ?? {})
    .filter(([, e]) => e.objectives.length + e.required.length + e.developed.length > 0).map(([r]) => r));
  for (const l of [...plan.links, ...plan.unlinked]) { refs.add(l.from); refs.add(l.to); }
  const changed = [...refs].filter(r => byCode.has(r) || proposed.has(r))
    .sort((a, b) => codeOf(a).localeCompare(codeOf(b)));

  // Skill texts anywhere on the map, to name a decision's two sides.
  const supplied = new Map<string, { course: string; text: string }>();
  for (const c of placed) for (const s of eff(c.ref)?.e.developed ?? []) supplied.set(s.skillRef, { course: c.code, text: s.statement });

  const lines: string[] = [];
  const toConfirm: string[] = [];
  const counts = { objectives: 0, required: 0, developed: 0, links: 0, decisions: 0 };
  const body: string[] = [];

  for (const ref of changed) {
    const x = eff(ref)!;
    const edits = plan.courseEdits?.[ref];
    const code = codeOf(ref);
    const src = edits?.source;
    const draftFrom = input.syllabusDrafts?.[ref] ?? (src?.kind === 'syllabus' ? { file: src.fileName, date: src.at } : undefined);
    body.push(`## ${esc(code)} ${esc(titleOf(ref))}${draftFrom ? ` (drafted from syllabus: ${esc(draftFrom.file)}, ${day(draftFrom.date)})` : ''}`, '');

    // Objectives
    const objLines = (edits?.objectives ?? []).map((e: ObjectiveEdit) => {
      counts.objectives++;
      const bloom = e.bloom ? ` [${e.bloom}]` : '';
      const kind = KIND[e.action];
      if (e.action !== 'remove') toConfirm.push(`${esc(code)}, objective: ${esc(e.text ?? '')}`);
      const before = e.target ? esc(e.target) : '';
      const after = e.text ? `${esc(e.text)}${DRAFT}` : '';
      const what = e.action === 'add' ? after : e.action === 'remove' ? before : `${before} → ${after}`;
      return `- ${NAMED[kind]}: ${what}${e.action === 'remove' ? '' : bloom}${stamp(e)}`;
    });
    body.push('### Objectives', '', ...(objLines.length ? objLines : ['- No changes']), '');

    // Skills
    const skillLines = (list: SkillEdit[], side: 'required' | 'developed') => list.map(e => {
      counts[side]++;
      const kind = KIND[e.action];
      const beforeSkill = e.target == null ? null : side === 'required'
        ? x.version?.required.find(r => r.ref === e.target) : x.version?.skills.find(s => s.skillRef === e.target);
      const beforeLevels = beforeSkill ? ('need' in beforeSkill ? beforeSkill.need : { k: beforeSkill.k, u: beforeSkill.u, d: beforeSkill.d }) : null;
      const before = beforeSkill ? `${esc(beforeSkill.statement)}${levels(beforeLevels)}` : esc(e.target ?? '');
      const after = e.statement ? `${esc(e.statement)}${levels(e.levels ?? beforeLevels)}${DRAFT}` : `${before}${DRAFT}`;
      if (e.action !== 'remove') toConfirm.push(`${esc(code)}, ${side} skill: ${esc(e.statement ?? before)}`);
      const what = e.action === 'add' ? after : e.action === 'remove' ? before : `${before} → ${after}`;
      let line = `- ${NAMED[kind]}: ${what}${stamp(e)}`;
      if (side === 'required' && e.action !== 'remove') {
        const afterRef = e.action === 'edit' && !e.statement ? e.target : e.statement ? hash(e.statement) : null;
        const r = required[ref]?.results.find(q => q.required.ref === afterRef);
        if (r) line += ` — ${statusLine(r)}`;
      }
      return line;
    });
    const reqLines = skillLines(edits?.required ?? [], 'required');
    body.push('### Required skills', '', ...(reqLines.length ? reqLines : ['- No changes']), '');
    const devLines = skillLines(edits?.developed ?? [], 'developed');
    body.push('### Developed skills', '', ...(devLines.length ? devLines : ['- No changes']), '');

    // Prerequisites and corequisites
    const linkLines: string[] = [];
    const rel = (l: { from: string; to: string; kind?: string }, verb: string) => {
      const kind = l.kind === 'coreq' ? 'corequisite' : 'prerequisite';
      const other = codeOf(l.from === ref ? l.to : l.from);
      const place = l.from === ref && kind === 'prerequisite' ? ' of' : '';
      return `- ${verb} ${kind}${place}: ${esc(other)}${verb === 'Removed' ? ' (set aside from the catalog)' : ''}`;
    };
    for (const l of plan.links.filter(l => named(l, ref))) linkLines.push(rel(l, 'Added'));
    for (const l of plan.unlinked.filter(l => named(l, ref))) linkLines.push(rel(l, 'Removed'));
    body.push('### Prerequisites and corequisites', '', ...(linkLines.length ? linkLines : ['- No changes']), '');

    // Match decisions on this course's required skills that appear in this plan
    const reqRefs = new Map(x.e.required.map(r => [r.ref, r.statement]));
    const decLines = decisions
      .filter(d => reqRefs.has(d.requiredRef) && supplied.has(d.suppliedRef))
      .map(d => {
        counts.decisions++;
        const s = supplied.get(d.suppliedRef)!;
        if (d.draft) toConfirm.push(`${esc(code)}, match decision: "${esc(reqRefs.get(d.requiredRef)!)}" ← ${esc(s.course)}: "${esc(s.text)}"`);
        return `- ${LABEL[d.label]}: "${esc(reqRefs.get(d.requiredRef)!)}" ← ${esc(s.course)}: "${esc(s.text)}" (${esc(d.by)}, ${day(d.at)})`;
      });
    body.push('### Match decisions', '', ...(decLines.length ? decLines : ['- No changes']), '');
  }

  counts.links = plan.links.length + plan.unlinked.length;
  let met = 0, metDraft = 0, partly = 0, not = 0;
  for (const c of Object.values(required)) { met += c.counts.met; metDraft += c.counts.met_draft; partly += c.counts.partly; not += c.counts.not; }

  lines.push(`# ${esc(input.planName)} — changes (${input.date})`, '');
  lines.push(`- Catalog year: ${input.catalogYear ? esc(input.catalogYear) : 'not set'}`, `- Exported by: ${esc(input.exportedBy)}`, '');
  lines.push('## Summary', '');
  if (!changed.length) lines.push('No changes: nothing on this map differs from the catalog and the captures.', '');
  else lines.push(
    `- Courses changed: ${changed.length}`,
    `- Objectives changed: ${counts.objectives}`,
    `- Required skills changed: ${counts.required}`,
    `- Developed skills changed: ${counts.developed}`,
    `- Prerequisites and corequisites changed: ${counts.links}`,
    `- Match decisions: ${counts.decisions}`, '');
  lines.push(`Required skills across the map: ${met} met, ${metDraft} met* (rests on a draft), ${partly} partly met, ${not} not met.`, '');
  lines.push('A trailing * marks a draft made on this map. Captures are never changed by a map edit; confirm drafts through capture.', '');
  lines.push(...body);
  if (changed.length) {
    lines.push('## To confirm through capture', '');
    lines.push(...(toConfirm.length ? toConfirm.map(t => `- ${t}`) : ['- Nothing: no drafts on this map.']), '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Every (required, developed) pair on the map where either side is a draft: the pairs whose judgments the
 * judge stored when the builder fetched them (keyed by text hash, like threads.ts). Eligibility is not
 * re-derived here; reading a few extra cached pairs is harmless.
 */
export function draftPairs(lib: Library, plan: PlanState): Array<{ requiredHash: string; suppliedHash: string }> {
  const byCode = new Map<string, LibraryCourse>(lib.courses.map(c => [c.code, c]));
  const proposed = new Map<string, ProposedCourse>(plan.proposed.map(p => [p.id, p]));
  const effs = placeCourses(lib, plan).filter(c => !c.requirement).flatMap(c => {
    const lc = byCode.get(c.ref) ?? proposed.get(c.ref);
    if (!lc) return [];
    return [{ ref: c.ref, e: effectiveCourse(lc, byCode.has(c.ref) ? versionOf(lc as LibraryCourse, plan) : null, plan.courseEdits?.[c.ref]) }];
  });
  const seen = new Set<string>();
  const out: Array<{ requiredHash: string; suppliedHash: string }> = [];
  for (const r of effs) for (const req of r.e.required) for (const s of effs) {
    if (s.ref === r.ref) continue;
    for (const sk of s.e.developed) {
      if (!req.draft && !sk.draft) continue;
      const k = `${req.ref}|${sk.skillRef}`;
      if (!seen.has(k)) { seen.add(k); out.push({ requiredHash: req.ref, suppliedHash: sk.skillRef }); }
    }
  }
  return out;
}
