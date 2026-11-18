'use client';

/**
 * The cluster objectives strip (spec goal 6): what the cluster as a whole is meant to deliver, each checked against the
 * developed skills of every course on the cluster. Add, edit and remove; each shows its status in words, the course
 * skills it rests on, and an override (target key `cobj:<id>`). A failed match shows the error and Try again, never
 * Not met.
 */
import { useState } from 'react';
import { statusLabel, type StatusResult } from '@/lib/builder/cluster/status';
import type { ClusterObjective, ClusterState } from '@/lib/builder/cluster/state';
import type { Update } from '../[id]/Builder';
import { newId } from '../[id]/ui';
import { OverrideControl } from './OverrideControl';
import { SupplierLines } from './StatusLine';

const MAX = 20; // the schema's limits (lib/builder/cluster/state.ts)
const TEXT_MAX = 500;

export function ClusterObjectives(props: {
  objectives: ClusterObjective[];
  /** clusterStatuses(...).cluster, by objective. */
  results: StatusResult[];
  codeOf: (ref: string) => string;
  update: Update<ClusterState>;
  /** The judging error for a pending objective, if its last match failed. */
  errorOf: (r: StatusResult) => string | null;
  onRetry: (r: StatusResult) => void;
  /** Who sets an override. */
  who: () => string;
}) {
  const { update } = props;
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim().slice(0, TEXT_MAX);
    if (!text || props.objectives.length >= MAX) return;
    update(s => ({ ...s, objectives: [...s.objectives, { id: newId('cobj'), text }] }));
    setDraft('');
  };
  const save = () => {
    if (!editing) return;
    const text = editing.text.trim().slice(0, TEXT_MAX);
    if (text) update(s => ({ ...s, objectives: s.objectives.map(o => (o.id === editing.id ? { ...o, text } : o)) }));
    setEditing(null);
  };

  return (
    <section className="cl-objectives" aria-label="Cluster objectives">
      <h2>Cluster objectives</h2>
      <p className="cb-muted">What these courses together should deliver. Each is checked against the developed skills of every course on the cluster, whatever the arrows.</p>
      {props.objectives.length > 0 && (
        <ul>
          {props.objectives.map(o => {
            const r = props.results.find(x => x.targetKey === `cobj:${o.id}`);
            const error = r && r.status === 'pending' ? props.errorOf(r) : null;
            return (
              <li key={o.id} className="cl-obj">
                {editing?.id === o.id ? (
                  <span className="cl-obj__edit">
                    <input value={editing.text} maxLength={TEXT_MAX} aria-label="Objective text" autoFocus
                      onChange={e => setEditing({ id: o.id, text: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(null); }} />
                    <button type="button" className="cb-btn" onClick={save}>Save</button>
                    <button type="button" className="cb-linkbtn" onClick={() => setEditing(null)}>Cancel</button>
                  </span>
                ) : (
                  <span className="cl-obj__text">{o.text}</span>
                )}
                {r && (
                  <span className={`cl-status cl-status--${error ? 'error' : r.status}`}>
                    {error ? (
                      <>{error} <button type="button" className="cb-linkbtn" onClick={() => props.onRetry(r)}>Try again</button></>
                    ) : statusLabel(r, props.codeOf)}
                    {r.reason && !error && <span className="cl-status__why"> ({r.reason})</span>}
                    {r.staleOverride && <span className="cl-status__why"> Override out of date (the objective changed)</span>}
                  </span>
                )}
                {r && editing?.id !== o.id && (
                  <div className="cl-objstatus">
                    <OverrideControl r={r} update={update} who={props.who} />
                    <SupplierLines r={r} codeOf={props.codeOf} />
                  </div>
                )}
                {editing?.id !== o.id && (
                  <span className="cl-obj__actions">
                    <button type="button" className="cb-linkbtn" onClick={() => setEditing({ id: o.id, text: o.text })}>Edit</button>
                    <button type="button" className="cb-linkbtn" onClick={() => update(s => ({ ...s, objectives: s.objectives.filter(x => x.id !== o.id) }))}>Remove</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {props.objectives.length < MAX ? (
        <form className="cl-obj__add" onSubmit={add}>
          <input value={draft} maxLength={TEXT_MAX} onChange={e => setDraft(e.target.value)} aria-label="New cluster objective"
            placeholder="e.g. Students can run a print job from file to finished piece" />
          <button type="submit" className="cb-btn">Add objective</button>
        </form>
      ) : <p className="cb-muted">A cluster holds at most {MAX} objectives.</p>}
    </section>
  );
}
