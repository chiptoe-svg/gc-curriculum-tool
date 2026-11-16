'use client';

/**
 * A course's required skills on this map: each one's status, the earlier skill that supplies it, and the faculty
 * controls (accept, partly, reject, pick another). Decisions are saved as shared evidence at once (spec
 * 2026-11-16-map-course-edits-and-required-skills-design.md §2); required-skill edits are drafts on this map only.
 */
import { useState } from 'react';
import type { ReqResult, ReqStatus } from '@/lib/builder/threads';
import type { Candidate, Depth, MatchDecision } from '@/lib/builder/types';
import type { Threads } from './Builder';
import { DepthInputs } from './controls';
import { JudgeStatus } from './CourseEditors';
import { dimName, fmtDepth } from './ui';

const STATUS_WORD: Record<ReqStatus, string> = { met: 'Met', met_draft: 'Met*', partly: 'Partly met', not: 'Not met' };
const PICK_MAX = 5;
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dims = (ds: Array<'k' | 'u' | 'd'>) => ds.map(dimName).join(', ');

export function statusWord(r: ReqResult): string {
  return r.status === 'partly' && r.faded.length ? `Partly met, faded (${dims(r.faded)})` : STATUS_WORD[r.status];
}

export function RequiredSkillsList(props: {
  courseRef: string; threads: Threads;
  onSave: (item: ReqResult['required'] | null, statement: string, need: Depth) => void;
  onRemove: (item: ReqResult['required']) => void;
}) {
  const { courseRef, threads } = props;
  const results = threads.byCourse[courseRef]?.results ?? [];
  const [adding, setAdding] = useState(false);
  const taken = results.map(r => r.required.statement);
  return (
    <>
      {results.length === 0 && <p className="cb-muted">No required skills recorded for this course.</p>}
      <ul className="cb-reqlist">
        {results.map((r, i) => <ReqRow key={`${i}|${r.required.ref}`} r={r} {...props} />)}
      </ul>
      {adding
        ? <SkillForm label="Required skill" levelsLabel="Needed" taken={taken} onCancel={() => setAdding(false)} onSave={(s, d) => { props.onSave(null, s, d); setAdding(false); }} />
        : <p><button type="button" className="cb-btn" onClick={() => setAdding(true)}>Add a required skill</button></p>}
    </>
  );
}

function ReqRow(props: {
  r: ReqResult; courseRef: string; threads: Threads;
  onSave: (item: ReqResult['required'] | null, statement: string, need: Depth) => void;
  onRemove: (item: ReqResult['required']) => void;
}) {
  const { r, threads, courseRef } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const taken = (threads.byCourse[courseRef]?.results ?? []).map(x => x.required.statement);
  const sup = r.supplier;
  // The supplier's own pair, for its decision and for the accept / partly / reject buttons.
  const current = sup ? r.candidates.find(c => c.suppliedCourse === sup.course && c.suppliedStatement === sup.statement) : undefined;
  const decisionOf = (c: Candidate): MatchDecision | undefined => threads.decisions[`${c.requiredRef}|${c.suppliedRef}`];
  const decision = current ? decisionOf(current) : undefined;
  const others = r.candidates.filter(c => c !== current && decisionOf(c)?.label !== 'not').slice(0, PICK_MAX);
  const rejected = r.candidates.filter(c => decisionOf(c)?.label === 'not');
  const judgeKey = `${courseRef}|required|${r.required.ref}`;

  const decide = async (c: Candidate, label: MatchDecision['label']) => {
    setBusy(true); setError(null);
    const err = await threads.decide(courseRef, r, c, label);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <li className={`cb-req cb-req--${r.status}`} data-req={r.required.ref}>
      <div>
        <span className={`cb-status cb-req--${r.status}`}>{statusWord(r)}</span>
        <span className={r.required.draft ? 'cb-draft' : undefined}>{r.required.statement}</span>
      </div>
      <div className="cb-req__meta">
        Needs <span className="cb-mono">{fmtDepth(r.required.need)}</span>
        {r.short.length > 0 && <> · short on {dims(r.short)}</>}
      </div>
      {sup ? (
        <div className="cb-req__meta">
          {sup.label === 'partly' ? 'Partly from' : 'From'} <b>{sup.course}</b>: <span className={sup.draft ? 'cb-draft' : undefined}>{sup.statement}</span>
          {decision && <> · {decision.label === 'fully' ? 'confirmed' : 'rated partly'} by {decision.by}, {date(decision.at)}</>}
          {!decision && sup.source === 'judge' && <> · suggested by the campus model</>}
          {r.restoredByDraft && <> · met with a map edit (a later draft supplier restores the level)</>}
        </div>
      ) : !threads.unasked.has(judgeKey) && !threads.judging[judgeKey] ? (
        // Only once judging has finished: while it runs (or failed) JudgeStatus says so instead.
        <div className="cb-req__meta">No earlier course on this map supplies it.</div>
      ) : null}
      {rejected.length > 0 && (
        <div className="cb-req__meta">Rejected: {rejected.map(c => `${c.suppliedCourse}, “${c.suppliedStatement.slice(0, 60)}${c.suppliedStatement.length > 60 ? '…' : ''}” (${decisionOf(c)!.by}, ${date(decisionOf(c)!.at)})`).join('; ')}</div>
      )}
      <JudgeStatus threads={threads} judgeKey={judgeKey} />
      <div className="cb-req__actions">
        {current && (
          <>
            <button type="button" className="cb-iconbtn" disabled={busy || decision?.label === 'fully'} onClick={() => decide(current, 'fully')} title="This earlier skill fully supplies the requirement">Accept</button>
            <button type="button" className="cb-iconbtn" disabled={busy || decision?.label === 'partly'} onClick={() => decide(current, 'partly')} title="It supplies part of the requirement">Partly</button>
            <button type="button" className="cb-iconbtn" disabled={busy} onClick={() => decide(current, 'not')} title="It does not supply the requirement">Reject</button>
          </>
        )}
        {others.length > 0 && (
          <select value="" disabled={busy} aria-label="Pick another supplier" onChange={e => { const c = others[Number(e.target.value)]; if (c) void decide(c, 'fully'); }}>
            <option value="">{current ? 'Pick another…' : 'Pick a supplier…'}</option>
            {others.map((c, i) => <option key={`${c.suppliedCourse}|${c.suppliedRef}`} value={i}>{c.suppliedCourse}: {c.suppliedStatement.slice(0, 90)}</option>)}
          </select>
        )}
        <button type="button" className="cb-linkbtn" onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</button>
        <button type="button" className="cb-linkbtn" onClick={() => props.onRemove(r.required)}>Remove</button>
      </div>
      {error && <p className="cb-error cb-small" role="alert">{error}</p>}
      {editing && (
        <SkillForm label="Required skill" levelsLabel="Needed" taken={taken} initial={{ statement: r.required.statement, levels: r.required.need }}
          onCancel={() => setEditing(false)} onSave={(s, d) => { props.onSave(r.required, s, d); setEditing(false); }} />
      )}
    </li>
  );
}

/** Statement plus K/U/D, for a required skill (needed levels) or a developed one (goal levels). */
export function SkillForm(props: {
  label: string; levelsLabel: string; initial?: { statement: string; levels: Depth };
  /** Statements already on the course: the same skill twice would count twice. */
  taken: string[];
  onSave: (statement: string, levels: Depth) => void; onCancel: () => void;
}) {
  const [statement, setStatement] = useState(props.initial?.statement ?? '');
  const [levels, setLevels] = useState<Depth>(props.initial?.levels ?? { k: null, u: null, d: null });
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
  const dup = norm(statement) !== norm(props.initial?.statement ?? '') && props.taken.some(t => norm(t) === norm(statement));
  const ok = statement.trim().length > 0 && !dup;
  return (
    <div className="cb-edit">
      <textarea rows={2} maxLength={600} value={statement} aria-label={props.label} placeholder="What students do" onChange={e => setStatement(e.target.value)} />
      <div className="cb-edit__row">
        {props.levelsLabel} <DepthInputs label={props.levelsLabel} foundational={false} value={levels} onChange={setLevels} />
        <button type="button" className="cb-btn" disabled={!ok} onClick={() => props.onSave(statement.trim(), levels)}>Save</button>
        <button type="button" className="cb-linkbtn" onClick={props.onCancel}>Cancel</button>
      </div>
      {dup && <p className="cb-error cb-small">This skill is already on the course.</p>}
    </div>
  );
}
