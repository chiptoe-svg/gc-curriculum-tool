'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { courseChanges, stringsAt, type OrphanSkill } from '@/lib/builder/strings/touch';
import { OrphanSkills, orphanCountOf } from './OrphanSkills';
import type { OrphanNote, PointStatus, StringGraph } from '@/lib/builder/strings/types';

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
  const orphanCount = orphanCountOf(orphans);

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
  if (here.length === 0 && changes.length === 0 && orphanCount === 0) return null;

  /** One standing when the string has one point here; one per point, with its skill, when it has two or more. */
  const standingAt = (s: (typeof here)[number]) => {
    const ids = s.path.filter((p) => graph.points[p]?.courseCode === courseCode);
    const word = (id: string) => STANDING[status[id]?.kind ?? 'unchecked'];
    return ids.length === 1 ? word(ids[0]!) : ids.map((id) => `${graph.points[id]!.statement}: ${word(id)}`).join(' · ');
  };
  return (
    <section className="cb st-panel" data-mode={mode}>
      {here.length > 0 && (
        <div>
          <h3 className={mode === 'capture' ? 'cap-title text-xl' : undefined}>Strings through this course</h3>
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
      <OrphanSkills compact={mode === 'capture'} courseCode={courseCode} orphans={orphans} authorName={name.trim() || null} onSaved={load} />
      {askName && <label className="st-name">Your name <input value={name} onChange={(e) => setName(e.target.value)} /></label>}
      {message && <p className="st-notice">{message}</p>}
    </section>
  );
}
