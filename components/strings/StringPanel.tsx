'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { sendStringWrite } from './sendStringWrite';
import { readString } from '@/lib/builder/strings/read';
import { stringChanges } from '@/lib/builder/strings/touch';
import type { PointStatus, StopReading, StringGraph } from '@/lib/builder/strings/types';
import type { Depth } from '@/lib/builder/types';
import type { Tree, VersionSkills } from '@/lib/skill-tree/types';
import { pathLabel } from '@/app/build/shared/skillTreeParts';

export interface StringPanelProps {
  graph: StringGraph;
  status: Record<string, PointStatus>;
  stringId: string;
  levelOf: (code: string) => number;
  editable: boolean;
  /** Receives a PATCH of the graph (a write response or one string's GET): lay it over the current graph with mergeGraph. */
  onChanged: (patch: StringGraph) => void;
  /** Where "Edit in a cluster" goes (read-only view). */
  editHref?: string;
  /** The signed-in name; when absent an editable panel asks for one. */
  authorName?: string | null;
  /** Library evidence for a stop (projects and outcomes); the line shows only when this returns items. */
  evidenceOf?: (courseCode: string, statement: string) => string[];
  /** Link to another string; keeps the page's access query. Default /strings/{id}. */
  hrefOf?: (stringId: string) => string;
  /** Re-run the status check; offered next to "Couldn't check". */
  onRetry?: () => void;
  /** The skill tree and each course's captures, for stops that check against a tree skill; without them such a stop reads as not checkable. */
  tree?: Tree | null;
  versionsOf?: (code: string) => VersionSkills[];
  /** Hooks for the cluster's extend / branch / merge / remove controls (Task 7). */
  stopActions?: (stop: StopReading, position: number) => ReactNode;
  stringActions?: () => ReactNode;
}

const GONE = { kind: 'unanchored', why: 'skill gone' } as const;

const fmt = (d: Depth | null) => (d ? `K${d.k ?? '–'} U${d.u ?? '–'} D${d.d ?? '–'}` : null);
const listDims = (dims: string[]) => dims.map((d) => d.toUpperCase()).join(', ');
const EVENT_WORDS: Record<string, string> = {
  locked: 'locked', unlocked: 'unlocked', relocked: 'locked again', renamed: 'renamed', extended: 'extended', branched: 'branched off',
  merged: 'merged', unmerged: 'unmerged', joined: 'joined', point_removed: 'skill removed', reword_confirmed: 'rewording confirmed',
  link_why: 'reason added', end_note: 'end note', orphan_note: 'note on an unused skill',
};
const eventWords = (k: string) => EVENT_WORDS[k] ?? k.replace(/_/g, ' ');
const when = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

/** A button that opens one small text field, then submits it. */
function InlineForm({ open, label, field, submit, required = true, initial = '', disabled, onSubmit }: {
  open: string; label: string; field: string; submit: string; required?: boolean; initial?: string; disabled?: boolean;
  /** Resolves true when the write took; the form closes only then. */
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [shown, setShown] = useState(false);
  const [text, setText] = useState(initial);
  if (!shown) return <button type="button" className="cb-linkbtn" disabled={disabled} onClick={() => setShown(true)}>{open}</button>;
  return (
    <form className="st-form" onSubmit={(e) => { e.preventDefault(); void onSubmit(text.trim()).then((ok) => { if (ok) setShown(false); }); }}>
      <label>{label}<input aria-label={field} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <button type="submit" className="cb-btn" disabled={disabled || (required && !text.trim())}>{submit}</button>
      <button type="button" className="cb-linkbtn" onClick={() => setShown(false)}>Cancel</button>
    </form>
  );
}

export function StringPanel(props: StringPanelProps) {
  const { graph, stringId, levelOf, editable, onChanged, editHref, evidenceOf, hrefOf = (id: string) => `/strings/${id}`, onRetry, stopActions, stringActions } = props;
  const [typedName, setTypedName] = useState('');
  const [notNow, setNotNow] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const str = graph.strings.find((s) => s.id === stringId);
  if (!str) return <p className="cb-empty">String not found.</p>;
  const name = (props.authorName ?? typedName).trim();
  const status = { ...props.status };
  for (const id of notNow) status[id] = GONE;
  const reading = readString(graph, stringId, status, levelOf, { fade: null, tree: props.tree ?? undefined, versionsOf: props.versionsOf });
  const changes = stringChanges(graph, status, stringId, levelOf);
  const nameOf = (id: string) => graph.strings.find((s) => s.id === id)?.name ?? 'another string';
  const cannotWrite = busy || !name;

  async function send(url: string, method: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      const r = await sendStringWrite({ url, method, body, authorName: name, reloadStringId: stringId, onChanged });
      if (!r.ok) setNotice(r.notice);
      return r.ok;
    } finally { setBusy(false); }
  }
  const patch = (body: Record<string, unknown>): Promise<boolean> => send(`/api/strings/${stringId}`, 'PATCH', { ...body, version: str.version });

  const events = graph.events
    .filter((e) => e.stringId === stringId || (e.pointId !== null && str.path.includes(e.pointId)))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const acts = [1, 2, 3] as const;
  return (
    <section className="st-panel">
      <header className="st-head">
        <h2>{str.name}</h2>
        <span className="st-status">{str.status === 'active' ? 'Locked' : 'Unlocked'}</span>
        {str.description && <p className="cb-muted">{str.description}</p>}
        {!editable && editHref && <Link href={editHref} className="cb-btn">Edit in a cluster</Link>}
      </header>

      {editable && (
        <div className="st-tools">
          {!props.authorName && (
            <label className="st-name">Your name <input value={typedName} onChange={(e) => setTypedName(e.target.value)} /></label>
          )}
          <InlineForm open="Rename" label="New name" field="New name" submit="Save name" initial={str.name} disabled={cannotWrite}
            onSubmit={(t) => patch({ action: 'rename', name: t })} />
          {str.status === 'active'
            ? <InlineForm open="Unlock" label="Reason" field="Reason" submit="Unlock string" disabled={cannotWrite}
                onSubmit={(t) => patch({ action: 'unlock', reason: t })} />
            : <button type="button" className="cb-linkbtn" disabled={cannotWrite} onClick={() => void patch({ action: 'relock' })}>Relock</button>}
          {str.mergedInto && (
            <InlineForm open="Unmerge" label="Reason" field="Reason" submit="Unmerge string" disabled={cannotWrite}
              onSubmit={(t) => patch({ action: 'unmerge', reason: t })} />
          )}
          {stringActions?.()}
        </div>
      )}
      {notice && <p className="st-notice">{notice}</p>}

      {acts.map((act) => {
        const stops = reading.stops.map((s, i) => ({ s, i })).filter(({ s }) => s.act === act);
        if (stops.length === 0) return null;
        return (
          <div key={act} className="st-act">
            <h3>Act {act}</h3>
            <ol className="st-stops">
              {stops.map(({ s, i }) => {
                const p = graph.points[s.pointId]!;
                const prev = i > 0 ? graph.points[reading.stops[i - 1]!.pointId] : undefined;
                const link = i > 0 ? graph.links.find((l) => l.from === reading.stops[i - 1]!.pointId && l.to === s.pointId) : undefined;
                const lock: Depth = { k: p.k, u: p.u, d: p.d };
                const moved = s.depth && (s.depth.k !== lock.k || s.depth.u !== lock.u || s.depth.d !== lock.d);
                const evidence = (evidenceOf?.(s.courseCode, p.statement) ?? []).slice(0, 5);
                return (
                  <li key={s.pointId} className="st-stop">
                    <div className="st-stop__line">
                      <strong className="cb-mono">{s.courseCode}</strong>
                      <span className="st-role">{s.role === 'develops' ? 'develops' : 'needs'}</span>
                      <span className="st-words">{p.statement}</span>
                    </div>
                    <div className="st-depth cb-muted">
                      {s.depth ? <>Now {fmt(s.depth)}</> : <>At lock {fmt(lock)}</>}
                      {s.depth && moved && <> (at lock {fmt(lock)})</>}
                      {s.slip.length > 0 && <> · Slipped in {listDims(s.slip)}</>}
                      {s.gap.length > 0 && <> · Gap in {listDims(s.gap)}</>}
                      {s.reinforces && <> · Reinforces</>}
                    </div>
                    {s.nodeCheck && (
                      <p className="st-depth cb-muted">
                        {s.nodeCheck.kind === 'not-checkable' || !props.tree
                          ? 'Checked against a tree skill, but that cannot be done right now (the skill tree is not loaded, or it no longer has this skill).'
                          : <>Checked against {pathLabel(props.tree, s.nodeCheck.nodeId)}: needs {fmt(s.nodeCheck.need)}, arriving {fmt(s.nodeCheck.arriving)}{s.nodeCheck.met ? ' (met)' : ' (not met)'}</>}
                      </p>
                    )}
                    <StopStatus s={s} nameBusy={cannotWrite} editable={editable} onRetry={onRetry}
                      confirm={() => s.status.kind === 'changed' && send(`/api/strings/points/${s.pointId}`, 'POST', {
                        candidate: s.status.candidate,
                      })}
                      notSame={() => setNotNow(new Set([...notNow, s.pointId]))} />
                    {i > 0 && (s.why !== null ? <p className="st-why">Why: {s.why}</p> : (
                      <p className="st-why">
                        Why: carried on past {prev?.courseCode ?? 'the earlier course'}.{' '}
                        {editable && link && (
                          <InlineForm open="Add why" label="Why" field="Why" submit="Save why" disabled={cannotWrite}
                            onSubmit={(t) => patch({ action: 'link-why', linkId: link.id, why: t })} />
                        )}
                      </p>
                    ))}
                    {evidence.length > 0 && <p className="st-evidence cb-muted">Course evidence: {evidence.join('; ')}</p>}
                    {s.mergedIn.map((id) => <p key={id} className="cb-muted"><Link href={hrefOf(id)}>{nameOf(id)}</Link> merged in here</p>)}
                    {s.sharedWith.map((o) => (
                      <p key={o.stringId} className="cb-muted">
                        {o.relation === 'joins' ? 'joined by ' : ''}<Link href={hrefOf(o.stringId)}>{nameOf(o.stringId)}</Link>{o.relation === 'branches' ? ' branches off here' : ''}
                      </p>
                    ))}
                    {editable && stopActions?.(s, i)}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      <p className="cb-muted">Reinforced {reading.reinforcement} {reading.reinforcement === 1 ? 'time' : 'times'}</p>
      <div className="st-end">
        {reading.end.kind === 'ends'
          ? <p>{`Ends at ${reading.end.courseCode} (Act ${reading.end.act})`}{reading.end.note ? <span className="cb-muted"> {reading.end.note}</span> : null}</p>
          : <p>{`Merges into ${nameOf(reading.end.into)} at ${reading.end.courseCode}`}</p>}
        {editable && reading.end.kind === 'ends' && (
          <InlineForm open={str.endNote ? 'Edit end note' : 'Add end note'} label="Note" field="End note" submit="Save note" required={false}
            initial={str.endNote ?? ''} disabled={cannotWrite} onSubmit={(t) => patch({ action: 'end-note', note: t || null })} />
        )}
      </div>

      <h3>Changes</h3>
      {changes.length === 0 ? <p className="cb-empty">Nothing has changed since this string was locked.</p> : (
        <ul className="st-list">{changes.map((c, i) => <li key={`${c.kind}-${c.pointId ?? c.linkId ?? i}-${i}`}>{c.text}</li>)}</ul>
      )}

      <h3>History</h3>
      {events.length === 0 ? <p className="cb-empty">No history yet.</p> : (
        <ul className="st-list">
          {events.map((e) => (
            <li key={e.id}>{eventWords(e.kind)}, {e.by}, {when(e.at)}{e.reason ? `: ${e.reason}` : ''}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StopStatus({ s, editable, nameBusy, onRetry, confirm, notSame }: {
  s: StopReading; editable: boolean; nameBusy: boolean; onRetry?: () => void; confirm: () => unknown; notSame: () => void;
}) {
  const st = s.status;
  if (st.kind === 'changed') {
    return (
      <p className="st-line">Reworded? <em>{st.candidate.statement}</em>{' '}
        {editable && <>
          <button type="button" className="cb-btn" disabled={nameBusy} onClick={() => void confirm()}>Confirm</button>{' '}
          <button type="button" className="cb-btn" onClick={notSame}>Not the same</button>
        </>}
      </p>
    );
  }
  if (st.kind === 'unanchored') return <p className="st-line">No longer anchored at {s.courseCode}</p>;
  if (st.kind === 'unchecked') {
    return onRetry
      ? <p className="st-line">Couldn&rsquo;t check: <button type="button" className="cb-linkbtn" onClick={onRetry}>try again</button></p>
      : <p className="st-line">Couldn&rsquo;t check: try again</p>;
  }
  return null;
}
