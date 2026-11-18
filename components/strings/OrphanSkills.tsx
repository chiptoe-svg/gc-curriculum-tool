'use client';
import { useState } from 'react';
import type { OrphanSkill } from '@/lib/builder/strings/touch';
import type { Role } from '@/lib/builder/strings/types';

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

export const orphanCountOf = (o: { developed: OrphanSkill[]; unsupplied: OrphanSkill[] } | null | undefined): number =>
  o ? o.developed.length + o.unsupplied.length : 0;

/**
 * "Skills on no string" for one course: the skills it develops and the ones it needs on entry that no active string
 * runs through, each with its note or an "Add a note" form. Saving posts to /api/strings/orphan-notes and calls `onSaved`.
 */
export function OrphanSkills({ courseCode, orphans, authorName, onSaved }: {
  courseCode: string;
  orphans: { developed: OrphanSkill[]; unsupplied: OrphanSkill[] } | null | undefined;
  /** The signed-in name; when absent a refusal for want of a name shows a field to type one. */
  authorName?: string | null;
  onSaved: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [askName, setAskName] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!orphans || orphanCountOf(orphans) === 0) return null;

  async function saveNote(role: Role, statement: string, reason: string): Promise<boolean> {
    setMessage(null);
    const by = (authorName || typed).trim();
    try {
      const res = await fetch('/api/strings/orphan-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseCode, role, statement, reason, ...(by ? { authorName: by } : {}) }),
      });
      if (res.ok) { await onSaved(); return true; }
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 400 && /name/i.test(err.error ?? '')) setAskName(true);
      setMessage(err.error ?? 'That did not save.');
    } catch { setMessage('That did not save.'); }
    return false;
  }
  const list = (role: Role, items: OrphanSkill[]) => items.map((o) => (
    <li key={`${role}-${o.hash}`}>
      <span>{o.statement}</span>
      {o.note ? <span className="cb-muted"> — {o.note}</span> : <> <NoteForm onSave={(r) => saveNote(role, o.statement, r)} /></>}
    </li>
  ));

  return (
    <div>
      <h3>Skills on no string</h3>
      {orphans.developed.length > 0 && <><p className="cb-muted">Developed here</p><ul>{list('develops', orphans.developed)}</ul></>}
      {orphans.unsupplied.length > 0 && <><p className="cb-muted">Needed on entry</p><ul>{list('requires', orphans.unsupplied)}</ul></>}
      {askName && !authorName && <label className="st-name">Your name <input value={typed} onChange={(e) => setTyped(e.target.value)} /></label>}
      {message && <p className="st-notice">{message}</p>}
    </div>
  );
}
