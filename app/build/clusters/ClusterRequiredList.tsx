'use client';

/**
 * A course's required skills on a cluster: each one's status (skills only), the upstream skills that supply it, and the
 * best candidates with Fully / Partly / Not, and a status override kept with the cluster. A decision is saved through the match API with the cluster's id and
 * counts at once; add, edit and remove are drafts on this cluster (courseEditOps). Built for cluster statuses rather
 * than forcing /build's RequiredSkillsList (its rows read plan threads, needed levels and fade).
 */
import { useState } from 'react';
import type { StatusResult } from '@/lib/builder/cluster/status';
import type { ClusterState } from '@/lib/builder/cluster/state';
import type { EffectiveCourse } from '@/lib/builder/edits';
import type { Candidate, Depth, MatchDecision } from '@/lib/builder/types';
import type { Update } from '../[id]/Builder';
import { SkillForm } from '../[id]/RequiredSkillsList';
import { OverrideControl } from './OverrideControl';
import { StatusLine, SupplierLines } from './StatusLine';

const BEST = 3;
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const LABEL_WORD: Record<MatchDecision['label'], string> = { fully: 'fully', partly: 'partly', not: 'not' };

type Req = EffectiveCourse['required'][number];

export function ClusterRequiredList(props: {
  courseRef: string; required: Req[]; results: StatusResult[]; codeOf: (ref: string) => string;
  /** Decisions in force on this cluster, by `${requiredRef}|${suppliedRef}`. */
  decisions: Record<string, MatchDecision>;
  decide: (r: StatusResult, cand: Candidate, label: MatchDecision['label']) => Promise<string | null>;
  errorOf: (r: StatusResult) => string | null; onRetry: (r: StatusResult) => void;
  onSave: (item: Req | null, statement: string, need: Depth) => void; onRemove: (item: Req) => void;
  /** For status overrides (ClusterState.overrides, target key `req:<courseRef>|<requiredRef>`). */
  update: Update<ClusterState>; who: () => string;
}) {
  const [adding, setAdding] = useState(false);
  const taken = props.required.map(r => r.statement);
  return (
    <>
      {props.required.length === 0 && <p className="cb-muted">No required skills recorded for this course.</p>}
      <ul className="cb-reqlist">
        {props.required.map((req, i) => {
          const r = props.results.find(x => x.targetKey === `req:${props.courseRef}|${req.ref}`);
          return <Row key={`${i}|${req.ref}`} req={req} r={r} taken={taken} {...props} />;
        })}
      </ul>
      {adding
        ? <SkillForm label="Required skill" levelsLabel="Needed" taken={taken} onCancel={() => setAdding(false)} onSave={(s, d) => { props.onSave(null, s, d); setAdding(false); }} />
        : <p><button type="button" className="cb-btn" onClick={() => setAdding(true)}>Add a required skill</button></p>}
    </>
  );
}

function Row(props: Parameters<typeof ClusterRequiredList>[0] & { req: Req; r: StatusResult | undefined; taken: string[] }) {
  const { req, r } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const decide = async (c: Candidate, label: MatchDecision['label']) => {
    if (!r) return;
    setBusy(true); setError(null);
    const err = await props.decide(r, c, label);
    setBusy(false);
    if (err) setError(err);
  };
  const best = (r?.candidates ?? []).slice(0, BEST);
  return (
    <li className={`cb-req cl-req--${r?.status ?? 'pending'}`} data-req={req.ref}>
      <div>
        {r && <StatusLine r={r} codeOf={props.codeOf} noun="skill" error={props.errorOf(r)} onRetry={() => props.onRetry(r)} />}{' '}
        <span className={req.draft ? 'cb-draft' : undefined}>{req.statement}</span>
      </div>
      {r && <SupplierLines r={r} codeOf={props.codeOf} />}
      {r && <div className="cl-objstatus"><OverrideControl r={r} update={props.update} who={props.who} /></div>}
      {best.length > 0 && (
        <ul className="cl-cands" aria-label="Closest upstream skills">
          {best.map(c => {
            const d = props.decisions[`${c.requiredRef}|${c.suppliedRef}`];
            return (
              <li key={`${c.suppliedCourse}|${c.suppliedRef}`} className="cl-cand">
                <span>{c.suppliedCourse}: {c.suppliedStatement}
                  {d && <span className="cb-muted cb-small"> · rated {LABEL_WORD[d.label]} by {d.by}, {date(d.at)}</span>}</span>
                <span className="cl-cand__acts">
                  <button type="button" className="cb-iconbtn" disabled={busy || d?.label === 'fully'} onClick={() => decide(c, 'fully')} title="This upstream skill fully supplies the requirement">Fully</button>
                  <button type="button" className="cb-iconbtn" disabled={busy || d?.label === 'partly'} onClick={() => decide(c, 'partly')} title="It supplies part of the requirement">Partly</button>
                  <button type="button" className="cb-iconbtn" disabled={busy || d?.label === 'not'} onClick={() => decide(c, 'not')} title="It does not supply the requirement">Not</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="cb-req__actions">
        <button type="button" className="cb-linkbtn" onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</button>
        <button type="button" className="cb-linkbtn" onClick={() => props.onRemove(req)}>Remove</button>
      </div>
      {error && <p className="cb-error cb-small" role="alert">{error}</p>}
      {editing && (
        <SkillForm label="Required skill" levelsLabel="Needed" taken={props.taken} initial={{ statement: req.statement, levels: req.need }}
          onCancel={() => setEditing(false)} onSave={(s, d) => { props.onSave(req, s, d); setEditing(false); }} />
      )}
    </li>
  );
}
