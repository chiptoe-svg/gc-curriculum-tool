'use client';

import { useState } from 'react';
import { FACULTY_ROSTER, DEPARTMENT_CANONICAL } from '@/lib/faculty';
import type { DriftEntry } from '@/lib/program/flags';

export interface AnnotatedFlag {
  id: string;
  targetKind: 'coverage_cell' | 'profile_competency';
  courseCode: string;
  careerTargetId: string | null;
  subCompetencyId: string | null;
  competencyStatement: string | null;
  note: string;
  flaggedBy: string;
  flaggedContext: { k: number | null; u: number | null; d: number | null } | null;
  status: 'open' | 'resolved';
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  drift: DriftEntry[] | null;
  stillInMatrix: boolean | null;
}

function driftLabel(d: DriftEntry): string {
  const dim = d.dim.toUpperCase();
  return `was ${dim}=${d.was ?? '—'} → now ${dim}=${d.now ?? '—'}`;
}

export function FlagsPanel({ flags, slug, isAdmin, onChanged }: {
  flags: AnnotatedFlag[];
  slug: string;
  /** F1 (owner decision, 2026-10-07): resolving a flag is admin-only — the
   *  server already enforces this (PATCH /api/flags/<id> is admin-kind in
   *  lib/auth/authorize.ts classify()); this just hides the control for a
   *  non-admin viewer instead of letting it 403. */
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [resolving, setResolving] = useState<string | null>(null);   // flag id with open resolve form
  const [name, setName] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('gc-flagger-name') ?? '';
  });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmResolve(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/flags/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolvedBy: name, resolutionNote: note.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? `resolve failed (${res.status})`);
        return;
      }
      localStorage.setItem('gc-flagger-name', name);
      setResolving(null);
      setNote('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (flags.length === 0) {
    return <p className="pg-meta pg-center" style={{ padding: 24 }}>No flags. Faculty can flag any matrix cell or profile competency they dispute.</p>;
  }

  return (
    <ul>
      {flags.map(f => (
        <li key={f.id} className="pg-flag">
          <div className="pg-row">
            <span aria-hidden className="pg-flagmark">⚑</span>
            <span className="pg-code">{f.courseCode}</span>
            <span className="pg-meta">
              {f.targetKind === 'coverage_cell'
                ? `${f.careerTargetId} · ${f.subCompetencyId}`
                : `"${f.competencyStatement}"`}
            </span>
            {f.status === 'resolved' && <span className="pg-cue pg-cue-done">resolved</span>}
            {f.stillInMatrix === false && (
              <span className="pg-cue pg-cue-input">no longer in matrix</span>
            )}
          </div>
          <p>{f.note}</p>
          <p className="pg-meta">
            {f.flaggedBy} · {new Date(f.createdAt).toLocaleDateString()}
            {f.flaggedContext && ` · flagged at K${f.flaggedContext.k ?? '—'}/U${f.flaggedContext.u ?? '—'}/D${f.flaggedContext.d ?? '—'}`}
          </p>
          {f.drift && (
            <p className="pg-cue pg-cue-input" style={{ height: 'auto', padding: '4px 10px', whiteSpace: 'normal' }}>
              Score changed since flagged: {f.drift.map(driftLabel).join(', ')}
            </p>
          )}
          {f.status === 'resolved' ? (
            <p className="pg-meta">↳ {f.resolutionNote} — {f.resolvedBy}, {f.resolvedAt ? new Date(f.resolvedAt).toLocaleDateString() : ''}</p>
          ) : !isAdmin ? null : resolving === f.id ? (
            <div className="pg-inset pg-stack" style={{ gap: 8 }}>
              <label htmlFor={`resolve-name-${f.id}`} className="block pg-meta">
                Resolving as
                <select id={`resolve-name-${f.id}`} value={name} onChange={e => setName(e.target.value)} className="pg-select mt-0.5 block w-full">
                  <option value="" disabled>Select your name…</option>
                  {FACULTY_ROSTER.filter(n => n !== DEPARTMENT_CANONICAL).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <textarea
                placeholder="resolution note (required)"
                rows={2}
                value={note}
                onChange={e => setNote(e.target.value)}
                className="pg-textarea"
              />
              {error && <p className="pg-err">{error}</p>}
              <div className="pg-row">
                <button type="button" onClick={() => void confirmResolve(f.id)} disabled={busy || !name || note.trim().length === 0}
                  className="pg-btn pg-btn-sm pg-btn-primary">
                  {busy ? 'Saving…' : 'Confirm resolve'}
                </button>
                <button type="button" onClick={() => setResolving(null)} className="pg-link">cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setResolving(f.id); setError(null); setNote(''); }} className="pg-link">
              Resolve…
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
