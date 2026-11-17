'use client';

/**
 * Map edits on one course: objectives, developed skills, and the lists of what changed and what a capture still has
 * to confirm. Every edit is a draft on this plan only (PlanState.courseEdits); captures are never changed.
 */
import { useState } from 'react';
import { BLOOM, proposeBloom, type BloomProcess } from '@/lib/builder/bloom';
import type { EffectiveCourse } from '@/lib/builder/edits';
import { editsOf, removeObjective, removeSkill, saveObjective, saveSkill, withEdits } from '@/lib/builder/edit-ops';
import type { CourseEdits, Depth, EditBase, Link, MapCore } from '@/lib/builder/types';
import type { ReqResult } from '@/lib/builder/threads';
import type { Threads, Update } from './Builder';
import { SkillForm, statusWord } from './RequiredSkillsList';
import { fmtDepth } from './ui';

type Stamp = () => EditBase;
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Edit operations on one course, each stamped with who and when. */
export function courseEditOps<S extends MapCore>(courseRef: string, update: Update<S>, stamp: Stamp) {
  const on = (fn: (e: CourseEdits) => CourseEdits) => update(p => withEdits(p, courseRef, fn));
  return {
    saveRequired: (item: { ref: string; statement: string; draft: boolean } | null, statement: string, need: Depth) =>
      on(e => ({ ...e, required: saveSkill(e.required, item, statement, need, stamp()) })),
    removeRequired: (item: { ref: string; statement: string; draft: boolean }) => on(e => ({ ...e, required: removeSkill(e.required, item, stamp()) })),
    saveDeveloped: (item: { skillRef: string; statement: string; draft: boolean } | null, statement: string, goal: Depth) =>
      on(e => ({ ...e, developed: saveSkill(e.developed, item && { ref: item.skillRef, statement: item.statement, draft: item.draft }, statement, goal, stamp()) })),
    removeDeveloped: (item: { skillRef: string; statement: string; draft: boolean }) =>
      on(e => ({ ...e, developed: removeSkill(e.developed, { ref: item.skillRef, statement: item.statement, draft: item.draft }, stamp()) })),
    saveObjective: (item: { text: string; draft: boolean } | null, text: string, bloom: BloomProcess | null) =>
      on(e => ({ ...e, objectives: saveObjective(e.objectives, item, text, bloom, stamp()) })),
    removeObjective: (item: { text: string; draft: boolean }) => on(e => ({ ...e, objectives: removeObjective(e.objectives, item, stamp()) })),
    undo: (kind: keyof CourseEdits, id: string) => on(e => ({ ...e, [kind]: (e[kind] as Array<{ id: string }>).filter(x => x.id !== id) })),
  };
}
export type EditOps = ReturnType<typeof courseEditOps<MapCore>>;

export function ObjectivesEditor(props: { eff: EffectiveCourse; ops: EditOps }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const items = props.eff.objectives;
  return (
    <>
      {items.length === 0 && <p className="cb-muted">No learning objectives on this map.</p>}
      <ul className="cb-items">
        {items.map((o, i) => (
          <li key={`${i}|${o.text}`}>
            {editing === i ? (
              <ObjectiveForm initial={o} onCancel={() => setEditing(null)} onSave={(t, b) => { props.ops.saveObjective(o, t, b); setEditing(null); }} />
            ) : (
              <>
                <span><span className={o.draft ? 'cb-draft' : undefined}>{o.text}</span> <span className="cb-muted cb-small">{o.bloom ?? 'no Bloom process'}</span></span>
                <span>
                  <button type="button" className="cb-linkbtn" onClick={() => setEditing(i)}>Edit</button>{' '}
                  <button type="button" className="cb-linkbtn" onClick={() => props.ops.removeObjective(o)}>Remove</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new'
        ? <ObjectiveForm onCancel={() => setEditing(null)} onSave={(t, b) => { props.ops.saveObjective(null, t, b); setEditing(null); }} />
        : <p><button type="button" className="cb-btn" onClick={() => setEditing('new')}>Add an objective</button></p>}
    </>
  );
}

/** Objective text and its Bloom process, proposed from the leading verb until the editor picks one. */
function ObjectiveForm(props: { initial?: { text: string; bloom: BloomProcess | null }; onSave: (text: string, bloom: BloomProcess | null) => void; onCancel: () => void }) {
  const [text, setText] = useState(props.initial?.text ?? '');
  const [bloom, setBloom] = useState<BloomProcess | null>(props.initial?.bloom ?? null);
  const [picked, setPicked] = useState(false);
  // Proposed from the text as it is typed; the saved process stands only while the text is unchanged.
  const shown = picked ? bloom : text === props.initial?.text ? props.initial.bloom : proposeBloom(text);
  return (
    <div className="cb-edit">
      <textarea rows={2} maxLength={600} value={text} aria-label="Objective" placeholder="Students will be able to…" onChange={e => setText(e.target.value)} />
      <div className="cb-edit__row">
        <label>Bloom process{' '}
          <select value={shown ?? ''} onChange={e => { setPicked(true); setBloom((e.target.value || null) as BloomProcess | null); }}>
            <option value="">None</option>
            {BLOOM.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <button type="button" className="cb-btn" disabled={!text.trim()} onClick={() => props.onSave(text.trim(), shown)}>Save</button>
        <button type="button" className="cb-linkbtn" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** A draft skill's judging state: "Matching…" while it runs, the error and Try again when it failed. */
/** What judging shows for one skill: its state, and Try again. */
export type JudgeView = Pick<Threads, 'judging' | 'retryJudge'>;

export function JudgeStatus(props: { threads: JudgeView; judgeKey: string }) {
  const state = props.threads.judging[props.judgeKey];
  if (!state) return null;
  if (state === 'matching') return <div className="cb-req__meta" role="status">Matching…</div>;
  return <div className="cb-error cb-small" role="alert">{state} <button type="button" className="cb-linkbtn" onClick={() => props.threads.retryJudge(props.judgeKey)}>Try again</button></div>;
}

/** `conditionMissing`: drafted statements whose syllabus states no condition for Do, so their Do goal was held at 2. */
export function DevelopedSkillsEditor(props: { eff: EffectiveCourse; ops: EditOps; courseRef: string; threads: JudgeView; conditionMissing?: Set<string> }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const items = props.eff.developed;
  return (
    <>
      {items.length === 0 && <p className="cb-muted">No developed skills on this map.</p>}
      <ul className="cb-items">
        {items.map((s, i) => (
          <li key={`${i}|${s.skillRef}`}>
            {editing === s.skillRef ? (
              <SkillForm label="Developed skill" levelsLabel="Goal" taken={items.map(x => x.statement)} initial={{ statement: s.statement, levels: { k: s.k, u: s.u, d: s.d } }}
                onCancel={() => setEditing(null)} onSave={(t, d) => { props.ops.saveDeveloped(s, t, d); setEditing(null); }} />
            ) : (
              <>
                <span><span className={s.draft ? 'cb-draft' : undefined}>{s.statement}</span> <span className="cb-mono cb-muted">{fmtDepth(s)}</span>
                  {s.draft && props.conditionMissing?.has(s.statement) && <span className="cb-muted cb-small" title="The syllabus states no condition (independently, in new conditions…) for this skill, so its Do goal is held at 2"> · no condition stated</span>}
                  {s.draft && <JudgeStatus threads={props.threads} judgeKey={`${props.courseRef}|supplied|${s.skillRef}`} />}</span>
                <span>
                  <button type="button" className="cb-linkbtn" onClick={() => setEditing(s.skillRef)}>Edit</button>{' '}
                  <button type="button" className="cb-linkbtn" onClick={() => props.ops.removeDeveloped(s)}>Remove</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new'
        ? <SkillForm label="Developed skill" levelsLabel="Goal" taken={items.map(x => x.statement)} onCancel={() => setEditing(null)} onSave={(t, d) => { props.ops.saveDeveloped(null, t, d); setEditing(null); }} />
        : <p><button type="button" className="cb-btn" onClick={() => setEditing('new')}>Add a developed skill</button></p>}
    </>
  );
}

const KIND_WORD = { objectives: 'Objective', required: 'Required skill', developed: 'Developed skill' } as const;
const ACTION_WORD = { add: 'added', edit: 'changed', remove: 'removed' } as const;

/** Every map change on this course, with who and when; each can be undone. Original wording comes from `original`. */
export function ChangesList<S extends MapCore>(props: {
  courseRef: string; plan: MapCore; ops: EditOps; update: Update<S>; label: (ref: string) => string;
  original: { required: Map<string, string>; developed: Map<string, string> };
}) {
  const { courseRef, plan } = props;
  const edits = editsOf(plan, courseRef);
  const rows: Array<{ key: string; text: React.ReactNode; undo: () => void }> = [];
  for (const kind of ['objectives', 'required', 'developed'] as const) {
    for (const e of edits[kind]) {
      const before = e.target == null ? null : kind === 'objectives' ? e.target : props.original[kind].get(e.target) ?? 'a skill';
      const after = 'text' in e ? e.text : e.statement;
      const levels = 'levels' in e && e.levels ? ` ${fmtDepth(e.levels)}` : '';
      const bloom = 'bloom' in e && e.bloom ? ` (${e.bloom})` : '';
      rows.push({
        key: e.id,
        text: <>{KIND_WORD[kind]} {ACTION_WORD[e.action]}: {before && e.action !== 'add' ? <>“{before}”{e.action === 'edit' ? ' → ' : ''}</> : null}
          {e.action !== 'remove' && <><span className="cb-draft">{after}</span>{bloom}{levels}</>} <span className="cb-muted">({e.by}, {date(e.at)})</span></>,
        undo: () => props.ops.undo(kind, e.id),
      });
    }
  }
  const named = (l: Link) => l.from === courseRef || l.to === courseRef;
  for (const l of plan.links.filter(named)) {
    rows.push({
      key: `link|${l.from}|${l.to}`,
      text: <>{l.kind === 'coreq' ? 'Corequisite' : 'Prerequisite'} added: {props.label(l.from)} {l.kind === 'coreq' ? 'with' : 'before'} {props.label(l.to)}</>,
      undo: () => props.update(p => ({ ...p, links: p.links.filter(x => !(x.from === l.from && x.to === l.to)) })),
    });
  }
  for (const l of plan.unlinked.filter(named)) {
    rows.push({
      key: `unlink|${l.from}|${l.to}`,
      text: <>Catalog prerequisite set aside: {props.label(l.from)} before {props.label(l.to)}</>,
      undo: () => props.update(p => ({ ...p, unlinked: p.unlinked.filter(x => !(x.from === l.from && x.to === l.to)) })),
    });
  }
  if (!rows.length) return <p className="cb-muted">No changes on this map.</p>;
  return (
    <ul className="cb-changes">
      {rows.map(r => <li key={r.key}>{r.text} <button type="button" className="cb-linkbtn" onClick={r.undo}>Undo</button></li>)}
    </ul>
  );
}

/** Draft items on this course, and required skills met only by counting a map edit: what a capture has to confirm. */
export function ToConfirm(props: { eff: EffectiveCourse; results: ReqResult[] }) {
  const items = [
    ...props.eff.objectives.filter(o => o.draft).map(o => `Objective: ${o.text}`),
    ...props.eff.required.filter(r => r.draft).map(r => `Required skill: ${r.statement}`),
    ...props.eff.developed.filter(s => s.draft).map(s => `Developed skill: ${s.statement}`),
    ...props.results.filter(r => r.status === 'met_draft' && !r.required.draft).map(r => `${statusWord(r)}: ${r.required.statement}`),
  ];
  if (!items.length) return <p className="cb-muted">Nothing on this course rests on a map edit.</p>;
  return <ul className="cb-list">{items.map((t, i) => <li key={i} className="cb-draft">{t}</li>)}</ul>;
}
