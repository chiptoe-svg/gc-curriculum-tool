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

export function FlagsPanel({ flags, slug, onChanged }: {
  flags: AnnotatedFlag[];
  slug: string;
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
    return <p className="px-4 py-6 text-center text-xs text-muted-foreground">No flags. Faculty can flag any matrix cell or profile competency they dispute.</p>;
  }

  return (
    <ul className="divide-y">
      {flags.map(f => (
        <li key={f.id} className="space-y-1.5 px-4 py-3 text-xs">
          <div className="flex items-baseline gap-2">
            <span aria-hidden>⚑</span>
            <span className="font-mono text-[11px]">{f.courseCode}</span>
            <span className="text-muted-foreground">
              {f.targetKind === 'coverage_cell'
                ? `${f.careerTargetId} · ${f.subCompetencyId}`
                : `"${f.competencyStatement}"`}
            </span>
            {f.status === 'resolved' && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">resolved</span>}
            {f.stillInMatrix === false && (
              <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">no longer in matrix</span>
            )}
          </div>
          <p>{f.note}</p>
          <p className="text-[11px] text-muted-foreground">
            {f.flaggedBy} · {new Date(f.createdAt).toLocaleDateString()}
            {f.flaggedContext && ` · flagged at K${f.flaggedContext.k ?? '—'}/U${f.flaggedContext.u ?? '—'}/D${f.flaggedContext.d ?? '—'}`}
          </p>
          {f.drift && (
            <p className="text-[11px] font-medium text-amber-800">
              Score changed since flagged: {f.drift.map(driftLabel).join(', ')}
            </p>
          )}
          {f.status === 'resolved' ? (
            <p className="text-[11px] text-muted-foreground">↳ {f.resolutionNote} — {f.resolvedBy}, {f.resolvedAt ? new Date(f.resolvedAt).toLocaleDateString() : ''}</p>
          ) : resolving === f.id ? (
            <div className="space-y-1.5 rounded border bg-muted/30 p-2">
              <label htmlFor={`resolve-name-${f.id}`} className="block text-[11px] text-muted-foreground">
                Resolving as
                <select id={`resolve-name-${f.id}`} value={name} onChange={e => setName(e.target.value)} className="mt-0.5 block w-full rounded border border-input bg-background px-2 py-1 text-xs">
                  <option value="" disabled>Select your name…</option>
                  {FACULTY_ROSTER.filter(n => n !== DEPARTMENT_CANONICAL).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <textarea
                placeholder="resolution note (required)"
                rows={2}
                value={note}
                onChange={e => setNote(e.target.value)}
                className="block w-full rounded border border-input bg-background px-2 py-1 text-xs"
              />
              {error && <p className="text-[11px] text-amber-700">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => void confirmResolve(f.id)} disabled={busy || !name || note.trim().length === 0}
                  className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50">
                  {busy ? 'Saving…' : 'Confirm resolve'}
                </button>
                <button type="button" onClick={() => setResolving(null)} className="text-[11px] text-muted-foreground hover:text-foreground">cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setResolving(f.id); setError(null); }} className="text-[11px] underline-offset-2 hover:underline">
              Resolve…
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
