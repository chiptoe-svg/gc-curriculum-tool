'use client';

/**
 * The cluster's controls inside the string panel (StringPanel's stringActions / stopActions hooks): Merge into, Extend,
 * Branch from here and Remove. Each sends one PATCH and lays the answer over the page's graph; a stale version reloads.
 */
import { useState } from 'react';
import { checkBranch, checkMerge } from '@/lib/builder/strings/rules';
import type { StringGraph, StringRow } from '@/lib/builder/strings/types';
import { sameSkill, type LockPoint } from './stringsOnCluster';

const STALE = 'Someone else changed this string. Reloaded.';

interface Common {
  graph: StringGraph; str: StringRow; authorName: string; onChanged: (patch: StringGraph) => void;
}

function useWrite({ str, authorName, onChanged }: Common) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  /** The signed-in name; a login that names nobody types one here. */
  const name = (authorName || typed).trim();
  const nameField = authorName ? null : <label className="st-name">Your name <input aria-label="Your name" value={typed} onChange={e => setTyped(e.target.value)} /></label>;
  /** Resolves true when the write took. */
  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/strings/${str.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, version: str.version, authorName: name }),
      });
      const data = (await res.json().catch(() => ({}))) as { graph?: StringGraph; error?: string };
      if (res.ok && data.graph) { onChanged(data.graph); return true; }
      if (res.status === 409) {
        const again = await fetch(`/api/strings/${str.id}`).then(r => r.json()).catch(() => null) as { graph?: StringGraph } | null;
        if (again?.graph) onChanged(again.graph);
        setError(STALE);
        return false;
      }
      setError(data.error ?? 'That did not save.');
      return false;
    } finally { setBusy(false); }
  }
  return { busy, error, patch, name, nameField };
}

const labelOf = (p: LockPoint) => `${p.courseCode} ${p.role === 'develops' ? 'develops' : 'needs'}: ${p.statement}`;

/** A small form: some fields, one submit. */
function Form({ open, submit, disabled, error, children, onSubmit }: {
  open: string; submit: string; disabled: boolean; error: string | null; children: React.ReactNode; onSubmit: () => Promise<boolean>;
}) {
  const [shown, setShown] = useState(false);
  if (!shown) return <button type="button" className="cb-linkbtn" onClick={() => setShown(true)}>{open}</button>;
  return (
    <form className="st-form" onSubmit={e => { e.preventDefault(); void onSubmit().then(ok => { if (ok) setShown(false); }); }}>
      {children}
      <button type="submit" className="cb-btn" disabled={disabled}>{submit}</button>
      <button type="button" className="cb-linkbtn" onClick={() => setShown(false)}>Cancel</button>
      {error && <span className="cb-error cb-small" role="alert">{error}</span>}
    </form>
  );
}

function TargetSelect({ targets, value, onChange }: { targets: LockPoint[]; value: number; onChange: (i: number) => void }) {
  return (
    <label className="st-pick">Skill
      <select aria-label="Skill" value={value} onChange={e => onChange(Number(e.target.value))}>
        <option value={-1}>Choose a skill</option>
        {targets.map((t, i) => <option key={`${t.role}|${t.courseCode}|${t.statement}`} value={i}>{labelOf(t)}</option>)}
      </select>
    </label>
  );
}

/** Merge into and Extend, shown with the string's other tools. */
export function StringTools(props: Common & { targets: LockPoint[] }) {
  const { graph, str, targets } = props;
  const mergeable = graph.strings.filter(s => checkMerge(graph, str.id, s.id) === null);
  const onString = (t: LockPoint) => str.path.some(id => graph.points[id] && sameSkill(graph.points[id]!, t));
  const free = targets.filter(t => !onString(t));
  return (
    <>
      {str.status === 'active' && !str.mergedInto && mergeable.length > 0 && <MergeForm {...props} candidates={mergeable} />}
      {str.status === 'active' && <ExtendForm {...props} free={free} merged={!!str.mergedInto} />}
    </>
  );
}

function MergeForm(props: Common & { candidates: StringRow[] }) {
  const w = useWrite(props);
  const [into, setInto] = useState('');
  return (
    <Form open="Merge into…" submit="Merge" disabled={w.busy || !w.name || !into} error={w.error} onSubmit={() => w.patch({ action: 'merge', into })}>
      <label>String
        <select aria-label="Merge into" value={into} onChange={e => setInto(e.target.value)}>
          <option value="">Choose a string</option>
          {props.candidates.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {w.nameField}
    </Form>
  );
}

function ExtendForm(props: Common & { free: LockPoint[]; merged: boolean }) {
  const w = useWrite(props);
  const [i, setI] = useState(-1);
  const [at, setAt] = useState<'start' | 'end'>(props.merged ? 'start' : 'end');
  const [why, setWhy] = useState('');
  const target = props.free[i];
  return (
    <Form open="Extend…" submit="Extend string" disabled={w.busy || !w.name || !target || !why.trim()} error={w.error}
      onSubmit={() => w.patch({ action: 'extend', at, point: target, why: why.trim() })}>
      <TargetSelect targets={props.free} value={i} onChange={setI} />
      <label>At
        <select aria-label="Extend at" value={at} onChange={e => setAt(e.target.value as 'start' | 'end')}>
          {!props.merged && <option value="end">End</option>}<option value="start">Start</option>
        </select>
      </label>
      <label>Why <input aria-label="Why" value={why} onChange={e => setWhy(e.target.value)} /></label>
      {w.nameField}
    </Form>
  );
}

/** Remove and Branch from here, shown under one stop. */
export function StopTools(props: Common & { position: number; targets: LockPoint[] }) {
  const { graph, str, position, targets } = props;
  const canBranch = str.status === 'active' && checkBranch(graph, str.id, position) === null;
  const onString = (t: LockPoint) => str.path.some(id => graph.points[id] && sameSkill(graph.points[id]!, t));
  return (
    <>
      {str.status === 'active' && <RemoveForm {...props} />}
      {canBranch && <BranchForm {...props} free={targets.filter(t => !onString(t))} />}
    </>
  );
}

function RemoveForm(props: Common & { position: number }) {
  const w = useWrite(props);
  const [reason, setReason] = useState('');
  return (
    <Form open="Remove" submit="Remove skill" disabled={w.busy || !w.name || !reason.trim()} error={w.error}
      onSubmit={() => w.patch({ action: 'remove-point', position: props.position, reason: reason.trim() })}>
      <label>Reason <input aria-label="Reason" value={reason} onChange={e => setReason(e.target.value)} /></label>
      {w.nameField}
    </Form>
  );
}

function BranchForm(props: Common & { position: number; free: LockPoint[] }) {
  const w = useWrite(props);
  const [i, setI] = useState(-1);
  const [name, setName] = useState('');
  const [why, setWhy] = useState('');
  const target = props.free[i];
  return (
    <Form open="Branch from here" submit="Branch string" disabled={w.busy || !w.name || !target || !name.trim() || !why.trim()} error={w.error}
      onSubmit={() => w.patch({ action: 'branch', atPosition: props.position, name: name.trim(), point: target, why: why.trim() })}>
      <TargetSelect targets={props.free} value={i} onChange={setI} />
      <label>New string name <input aria-label="New string name" value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
      <label>Why <input aria-label="Why" value={why} onChange={e => setWhy(e.target.value)} /></label>
      {w.nameField}
    </Form>
  );
}
