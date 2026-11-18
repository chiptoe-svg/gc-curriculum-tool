'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { courseChanges, stringsAt, type OrphanSkill } from '@/lib/builder/strings/touch';
import type { OrphanNote, PointStatus, Role, StringGraph } from '@/lib/builder/strings/types';

interface Resolved { graph: StringGraph; status: Record<string, PointStatus>; levels: Record<string, number>; notes: OrphanNote[]; orphans?: Record<string, { developed: OrphanSkill[]; unsupplied: OrphanSkill[] }> }

export interface CourseStringsProps {
  courseCode: string;
  mode: 'course' | 'capture';
  /** The page's access query (`?slug=...`), kept on links to /strings/[id]. */
  query?: string;
}

const STANDING: Record<string, string> = {
  intact: 'Holds', changed: 'Reworded', unanchored: 'No longer anchored', unchecked: "Couldn't check",
};

function NoteForm({ onSave }: { onSave: (reason: string) => Promise<boolean> }) {
  const [shown, setShown] = useState(false);
  const [text, setText] = useState('');
  if (!shown) return <button type="button" className="cb-linkbtn" onClick={() => setShown(true)}>Add a note</button>;
  return (
    <form className="st-form" onSubmit={(e) => { e.preventDefault(); void onSave(text.trim()).then((ok) => { if (ok) setShown(false); }); }}>
      <label>Note<input aria-label="Note" value={text} onChange={(e) => setText(e.target.value)} /></label>
      <button type="submit" className="cb-btn" disabled={!text.trim()}>Save note</button>
      <button type="button" className="cb-linkbtn" onClick={() => setShown(false)}>Cancel</button>
    </form>
  );
}

export function CourseStrings({ courseCode, mode, query = '' }: CourseStringsProps) {
  const [data, setData] = useState<Resolved | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden' | 'failed'>('loading');
  const [name, setName] = useState('');
  const [askName, setAskName] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/strings/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseCodes: [courseCode] }) });
      if (res.status === 401 || res.status === 403) { setState('hidden'); return; }
      if (!res.ok) { setState('failed'); return; }
      setData((await res.json()) as Resolved);
      setState('ready');
    } catch { setState('failed'); }
  }, [courseCode]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading' || state === 'hidden') return null;
  if (state === 'failed' || !data) return <p className="cb-muted">Couldn&apos;t load strings.</p>;

  const { graph, status, levels } = data;
  const levelOf = (code: string) => levels[code] ?? 0;
  const here = stringsAt(graph, courseCode);
  const changes = courseChanges(graph, status, courseCode, levelOf);
  const orphans = data.orphans?.[courseCode] ?? null;
  const orphanCount = orphans ? orphans.developed.length + orphans.unsupplied.length : 0;

  async function post(url: string, body: Record<string, unknown>): Promise<Response | null> {
    setMessage(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...(name.trim() ? { authorName: name.trim() } : {}) }) });
      if (res.ok) return res;
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 400 && /name/i.test(err.error ?? '')) setAskName(true);
      setMessage(err.error ?? 'That did not save.');
    } catch { setMessage('That did not save.'); }
    return null;
  }
  async function confirm(pointId: string, candidate: { statement: string; hash: string }) {
    if (await post(`/api/strings/points/${pointId}`, { candidate })) await load();
  }
  async function saveNote(role: Role, statement: string, reason: string): Promise<boolean> {
    const res = await post('/api/strings/orphan-notes', { courseCode, role, statement, reason });
    if (!res) return false;
    await load();
    return true;
  }

  if (here.length === 0 && changes.length === 0 && orphanCount === 0) return null;

  const standingAt = (s: (typeof here)[number]) => {
    const id = s.path.find((p) => graph.points[p]?.courseCode === courseCode);
    return STANDING[(id && status[id]?.kind) || 'unchecked'];
  };
  const list = (role: Role, items: NonNullable<typeof orphans>['developed']) => items.map((o) => (
    <li key={`${role}-${o.hash}`}>
      <span>{o.statement}</span>
      {o.note ? <span className="cb-muted"> — {o.note}</span> : <> <NoteForm onSave={(r) => saveNote(role, o.statement, r)} /></>}
    </li>
  ));

  return (
    <section className="cb st-panel" data-mode={mode}>
      {here.length > 0 && (
        <div>
          <h3>Strings through this course</h3>
          <ul>
            {here.map((s) => (
              <li key={s.id}>
                <Link href={`/strings/${s.id}${query}`}>{s.name}</Link> <span className="cb-muted">{standingAt(s)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {changes.length > 0 && (
        <div>
          <h3>Changes</h3>
          <ul>
            {changes.map((c, i) => {
              const st = c.pointId ? status[c.pointId] : undefined;
              return (
                <li key={i}>
                  {c.text}{' '}
                  {c.kind === 'reworded' && c.pointId && st?.kind === 'changed' && (
                    <button type="button" className="cb-btn" onClick={() => void confirm(c.pointId!, st.candidate)}>Confirm</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {orphans && orphanCount > 0 && (
        <div>
          <h3>Skills on no string</h3>
          {orphans.developed.length > 0 && <><p className="cb-muted">Developed here</p><ul>{list('develops', orphans.developed)}</ul></>}
          {orphans.unsupplied.length > 0 && <><p className="cb-muted">Needed on entry</p><ul>{list('requires', orphans.unsupplied)}</ul></>}
        </div>
      )}
      {askName && <label className="st-name">Your name <input value={name} onChange={(e) => setName(e.target.value)} /></label>}
      {message && <p className="st-notice">{message}</p>}
    </section>
  );
}
