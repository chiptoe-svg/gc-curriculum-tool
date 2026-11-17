'use client';

/**
 * Import a course from its syllabus (spec §4b): pick the course, give the syllabus as a file or pasted text, and a free
 * campus model drafts its objectives, skills and named prerequisites. The draft comes back as map edits; Builder merges
 * them into the plan, which then saves and judges the drafted skills like any other draft.
 */
import { useState } from 'react';
import type { Act, CourseEdits, Library, Link, MapCore, ProposedCourse } from '@/lib/builder/types';
import { newCourseConflict } from '@/lib/builder/syllabus-codes';
import { newId } from './ui';

export interface SyllabusImported {
  ref: string;
  /** Set for a course invented in this dialog: Builder adds it to the plan. */
  created: ProposedCourse | null;
  /** The act to place the course in when it is not on the map yet. */
  act: Act;
  draft: { draftId: string; fileName: string; at: string; edits: CourseEdits; links: Link[] };
}

const MIN = 300; // the server's minimum (lib/builder/syllabus-draft.ts)

export function SyllabusImport(props: {
  /** Where the syllabus is posted: the plan's or the cluster's import route. */
  endpoint: string; library: Library; plan: MapCore; placed: Set<string>; author: () => string;
  /** How many new or catalog-only courses a plan can hold (the server's limit). */
  maxProposed: number;
  onClose: () => void; onImported: (r: SyllabusImported) => void;
}) {
  const uncaptured = props.library.courses.filter(c => c.versions.length === 0);
  const [choice, setChoice] = useState<string>('new');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [act, setAct] = useState<Act>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ref = choice === 'new' ? null : choice.slice(choice.indexOf(':') + 1);
  const onMap = ref != null && props.placed.has(ref);
  // A new course may not reuse a tracked course's code or one already proposed here (the server repeats the tracked check).
  const conflict = choice === 'new' && code.trim()
    ? newCourseConflict(code, props.library.courses.map(c => ({ code: c.code, captured: c.versions.length > 0 })), props.plan.proposed)
    : null;
  const ready = (choice !== 'new' || (code.trim() && title.trim() && !conflict)) && (file || text.trim().length >= MIN);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    if (choice === 'new' && props.plan.proposed.length >= props.maxProposed) {
      setError(`This plan already holds ${props.maxProposed} new or catalog-only courses. Remove one, or import into a course already on the plan.`);
      return;
    }
    setBusy(true);
    setError(null);
    const created: ProposedCourse | null = choice === 'new'
      ? { id: newId('new'), source: 'new', code: code.trim().slice(0, 40), credits: null, title: title.trim().slice(0, 160), description: '', objectives: [], depths: [] }
      : null;
    const courseRef = created?.id ?? ref!;
    const pc = props.plan.proposed.find(p => p.id === courseRef);
    const f = new FormData();
    f.append('courseRef', courseRef);
    f.append('code', created?.code ?? pc?.code ?? courseRef);
    f.append('title', created?.title ?? pc?.title ?? '');
    f.append('authorName', props.author());
    if (file) f.append('file', file);
    else f.append('text', text);
    try {
      const res = await fetch(props.endpoint, { method: 'POST', body: f });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.edits) {
        setError(typeof body?.error === 'string' ? body.error : res.status === 502 ? 'The campus model did not answer; try again.' : 'The import failed; try again.');
        setBusy(false);
        return;
      }
      props.onImported({ ref: courseRef, created, act, draft: body });
    } catch {
      setError('Could not reach the server; try again.');
      setBusy(false);
    }
  }

  return (
    <div className="cb-modal" role="dialog" aria-modal="true" aria-labelledby="cb-syl-title" onClick={e => { if (e.target === e.currentTarget && !busy) props.onClose(); }}>
      <form className="cb-modal__box" onSubmit={submit}>
        <h2 id="cb-syl-title">Import a course from a syllabus</h2>
        <p className="cb-muted cb-small">
          A campus model reads the syllabus and drafts the course&rsquo;s objectives, the skills it develops and needs, and the
          prerequisites it names. Everything it drafts is a goal, marked as a draft (<span className="cb-draft">italic</span>) until a capture confirms it.
        </p>

        <label className="cb-field">
          <span>Course</span>
          <select value={choice} onChange={e => setChoice(e.target.value)} disabled={busy}>
            <option value="new">A new course…</option>
            {props.plan.proposed.length > 0 && (
              <optgroup label="Proposed on this map">
                {props.plan.proposed.map(p => <option key={p.id} value={`plan:${p.id}`}>{p.code} {p.title}</option>)}
              </optgroup>
            )}
            {uncaptured.length > 0 && (
              <optgroup label="In the tool, not captured">
                {uncaptured.map(c => <option key={c.code} value={`lib:${c.code}`}>{c.code} {c.title}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {choice === 'new' && (
          <div className="cb-edit__row">
            <label className="cb-field"><span>Code</span><input value={code} onChange={e => setCode(e.target.value)} maxLength={40} placeholder="GC 4990" disabled={busy} /></label>
            <label className="cb-field cb-field--grow"><span>Title</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} disabled={busy} /></label>
          </div>
        )}
        {conflict && <p className="cb-error" role="alert">{conflict}</p>}

        <label className="cb-field">
          <span>Syllabus file (PDF, Word or text)</span>
          <input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={e => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
        </label>
        {!file && (
          <label className="cb-field">
            <span>or paste its text</span>
            <textarea rows={6} value={text} onChange={e => setText(e.target.value)} disabled={busy} />
            {text.trim().length > 0 && text.trim().length < MIN && <span className="cb-muted cb-small">At least {MIN} characters ({text.trim().length} so far).</span>}
          </label>
        )}

        {!onMap && (
          <label className="cb-field">
            <span>Place it in</span>
            <select value={act} onChange={e => setAct(Number(e.target.value) as Act)} disabled={busy}>
              <option value={1}>Act 1</option><option value={2}>Act 2</option><option value={3}>Act 3</option>
            </select>
          </label>
        )}

        {error && <p className="cb-error" role="alert">{error}</p>}
        {busy && <p className="cb-muted" role="status">Drafting from the syllabus… this can take up to a minute.</p>}
        <div className="cb-modal__actions">
          <button type="button" className="cb-btn" onClick={props.onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="cb-btn cb-btn--primary" disabled={!ready || busy}>Import</button>
        </div>
      </form>
    </div>
  );
}
