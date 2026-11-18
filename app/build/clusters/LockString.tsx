'use client';

/**
 * On a required skill that has suppliers: "Lock as string" (the ticked suppliers and the required skill become a string,
 * with a reason for each link) and "Add to string…" (put the required skill and a supplier on a string that already
 * passes through them). Only captured catalog courses can be on a string (lockPoint decides; `snapshotId` null = cannot).
 */
import { useState } from 'react';
import { sendStringWrite } from '@/components/strings/sendStringWrite';
import { orderPoints } from '@/lib/builder/strings/order';
import type { PointRow, StringGraph } from '@/lib/builder/strings/types';
import { CAPTURED_ONLY, addOptions, type AddOption, type LockPoint, type SkillInput } from './stringsOnCluster';

const keyOf = (p: SkillInput) => `${p.role}|${p.courseCode}|${p.statement}`;

/** The skills in string order, as the API takes them. */
function ordered(skills: SkillInput[], levelOf: (code: string) => number): SkillInput[] {
  const rows: PointRow[] = skills.map((s, i) => ({ id: String(i), ...s, statementHash: '', term: null }));
  return orderPoints(rows, levelOf).map(r => skills[Number(r.id)]!);
}
const wire = (p: SkillInput): LockPoint => ({ courseCode: p.courseCode, role: p.role, statement: p.statement, snapshotId: p.snapshotId!, k: p.k, u: p.u, d: p.d });

export function LockString(props: {
  required: SkillInput; suppliers: SkillInput[]; strings: StringGraph; levelOf: (code: string) => number;
  /** The signed-in name; when absent the form asks for one. */
  authorName?: string | null;
  /** Receives the write's graph, to lay over the page's graph with mergeGraph. */
  onLocked: (g: StringGraph) => void;
}) {
  const { required, suppliers, strings, levelOf } = props;
  const [mode, setMode] = useState<'lock' | 'add' | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [whys, setWhys] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [addWhy, setAddWhy] = useState('');

  const author = (props.authorName ?? typed).trim();
  const ticked = suppliers.filter(s => !off.has(keyOf(s)));
  const path = ordered([...ticked, required], levelOf);
  const capturedOnly = !required.snapshotId || ticked.some(s => !s.snapshotId);
  const options = addOptions(strings, required, ticked.length ? ticked : suppliers);

  async function send(url: string, method: string, body: Record<string, unknown>, staleId?: string) {
    setBusy(true); setError(null);
    try {
      const r = await sendStringWrite({ url, method, body, authorName: author, reloadStringId: staleId, onChanged: props.onLocked });
      if (r.ok) setMode(null); else setError(r.notice);
    } finally { setBusy(false); }
  }

  const linkKey = (i: number) => `${keyOf(path[i]!)}>${keyOf(path[i + 1]!)}`;
  const lockReady = !!name.trim() && !!author && !capturedOnly && path.slice(1).every((_, i) => (whys[linkKey(i)] ?? '').trim());
  const lock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockReady) return;
    void send('/api/strings', 'POST', {
      name: name.trim(), description: description.trim(), points: path.map(wire),
      whys: path.slice(1).map((_, i) => whys[linkKey(i)]!.trim()),
    });
  };

  const chosen: AddOption | null = pick === null ? null : options[pick] ?? null;
  const labelOf = (o: AddOption) => {
    const at = `${o.supplier.courseCode}`;
    if (o.kind === 'extend-end') return `Extend ${o.string.name} with ${required.courseCode} (it ends at ${at})`;
    if (o.kind === 'extend-start') return `Extend ${o.string.name} back to ${at} (it starts at ${required.courseCode})`;
    return `Branch off ${o.string.name} at ${at}`;
  };
  const addReady = !!chosen && !!author && !capturedOnly && !!addWhy.trim() && (chosen.kind !== 'branch' || !!name.trim());
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen || !addReady) return;
    const base = { version: chosen.string.version, why: addWhy.trim() };
    const id = chosen.string.id;
    if (chosen.kind === 'extend-end') void send(`/api/strings/${id}`, 'PATCH', { action: 'extend', at: 'end', point: wire(required), ...base }, id);
    else if (chosen.kind === 'extend-start') void send(`/api/strings/${id}`, 'PATCH', { action: 'extend', at: 'start', point: wire(chosen.supplier), ...base }, id);
    else void send(`/api/strings/${id}`, 'PATCH', { action: 'branch', atPosition: chosen.position, name: name.trim(), description: description.trim(), point: wire(required), ...base }, id);
  };

  const nameField = !props.authorName && (
    <label className="st-name">Your name <input value={typed} onChange={e => setTyped(e.target.value)} /></label>
  );

  return (
    <div className="st-lock">
      {mode === null && (
        <div className="cb-req__actions">
          <button type="button" className="cb-linkbtn" disabled={capturedOnly} onClick={() => setMode('lock')}>Lock as string</button>
          {options.length > 0 && <button type="button" className="cb-linkbtn" onClick={() => setMode('add')}>Add to string…</button>}
        </div>
      )}
      {capturedOnly && <p className="cb-muted cb-small">{CAPTURED_ONLY}</p>}

      {mode === 'lock' && (
        <form className="st-lockform" onSubmit={lock}>
          <fieldset>
            <legend>Skills on the string</legend>
            {suppliers.map(s => (
              <label key={keyOf(s)} className="st-tick">
                <input type="checkbox" checked={!off.has(keyOf(s))} disabled={!off.has(keyOf(s)) && ticked.length === 1}
                  onChange={() => setOff(o => { const n = new Set(o); if (n.has(keyOf(s))) n.delete(keyOf(s)); else n.add(keyOf(s)); return n; })} />
                {s.courseCode}: {s.statement}
              </label>
            ))}
          </fieldset>
          <label>String name <input aria-label="String name" value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
          <label>Description <input aria-label="Description" value={description} onChange={e => setDescription(e.target.value)} /></label>
          {path.slice(1).map((p, i) => (
            <label key={linkKey(i)}>Why {path[i]!.courseCode} leads to {p.courseCode}
              <input aria-label={`Why ${path[i]!.courseCode} leads to ${p.courseCode}`} value={whys[linkKey(i)] ?? ''}
                onChange={e => setWhys(w => ({ ...w, [linkKey(i)]: e.target.value }))} />
            </label>
          ))}
          {nameField}
          <button type="submit" className="cb-btn" disabled={busy || !lockReady}>Lock string</button>
          <button type="button" className="cb-linkbtn" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}

      {mode === 'add' && (
        <form className="st-lockform" onSubmit={add}>
          {options.map((o, i) => (
            <label key={i} className="st-tick">
              <input type="radio" name="st-add" checked={pick === i} onChange={() => setPick(i)} aria-label={labelOf(o)} />
              {labelOf(o)}
            </label>
          ))}
          {chosen?.kind === 'branch' && <>
            <label>New string name <input aria-label="New string name" value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
            <label>Description <input aria-label="Description" value={description} onChange={e => setDescription(e.target.value)} /></label>
          </>}
          <label>Why <input aria-label="Why" value={addWhy} onChange={e => setAddWhy(e.target.value)} /></label>
          {nameField}
          <button type="submit" className="cb-btn" disabled={busy || !addReady}>Add to string</button>
          <button type="button" className="cb-linkbtn" onClick={() => setMode(null)}>Cancel</button>
        </form>
      )}
      {error && <p className="st-notice" role="alert">{error}</p>}
    </div>
  );
}
