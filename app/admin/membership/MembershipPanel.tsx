'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ListedCompetency } from '@/lib/db/membership-queries';
import { BAND_LABELS, PINNED_LABEL } from '@/lib/catalog/membership';

// P3 membership addendum (spec 2026-10-21-p3-membership-from-weights-design.md §5):
// per target, the pinned and importance-based competencies, with Pin / Hide /
// Reset. Calls /api/admin/membership with the admin slug.

type Action = 'pin' | 'hide' | 'clear';

function importance(r: ListedCompetency): string {
  const label = r.band ? BAND_LABELS[r.band] : r.pinned ? PINNED_LABEL : 'Below somewhat important';
  return r.weight === null ? label : `${label} (${r.weight.toFixed(2)})`;
}

function status(r: ListedCompetency): string {
  if (r.hidden) return 'Hidden';
  if (!r.member) return 'Not shown';
  return r.pinned ? 'Shown — pinned' : 'Shown — by importance';
}

export function MembershipPanel({ slug }: { slug: string }) {
  const [targets, setTargets] = useState<Array<{ id: string; name: string }>>([]);
  const [rows, setRows] = useState<ListedCompetency[]>([]);
  const [targetId, setTargetId] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/membership?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!res.ok) { setMessage('Could not load the list.'); return; }
    const body = await res.json() as { targets: Array<{ id: string; name: string }>; rows: ListedCompetency[] };
    setTargets(body.targets);
    setRows(body.rows);
    setTargetId(prev => prev || body.targets[0]?.id || '');
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  async function act(r: ListedCompetency, action: Action) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/membership', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, targetId: r.careerTargetId, competencyId: r.competencyId, action }),
      });
      const body = await res.json() as { changes?: unknown[]; error?: string };
      if (!res.ok) { setMessage(body.error ?? 'The change failed.'); return; }
      const n = body.changes?.length ?? 0;
      setMessage(n === 0 ? 'Saved. No change to what this target shows.' : `${n} change${n === 1 ? '' : 's'} — refresh the wiki pages for this target.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const mine = rows.filter(r => r.careerTargetId === targetId);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {targets.map(t => (
          <button key={t.id} type="button" onClick={() => setTargetId(t.id)}
            className={`rounded border px-3 py-1 text-sm ${t.id === targetId ? 'bg-slate-800 text-white' : 'bg-white'}`}>
            {t.name}
          </button>
        ))}
      </div>
      {message && <p className="text-sm text-slate-700">{message}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-600">
            <th className="py-1">Competency</th><th>Importance</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {mine.map(r => (
            <tr key={r.competencyId} className="border-b align-top">
              <td className="py-1">{r.name}</td>
              <td>{importance(r)}</td>
              <td>{status(r)}</td>
              <td className="space-x-2 whitespace-nowrap text-right">
                {!r.pinned && <button type="button" disabled={busy} onClick={() => act(r, 'pin')} className="text-blue-700 underline">Pin</button>}
                {!r.hidden && <button type="button" disabled={busy} onClick={() => act(r, 'hide')} className="text-blue-700 underline">Hide</button>}
                {(r.pinned || r.hidden) && <button type="button" disabled={busy} onClick={() => act(r, 'clear')} className="text-blue-700 underline">Reset to importance only</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">
        Shown when pinned, or when importance is at least Important, unless hidden. Pin moves a competency to the end of the pinned list.
      </p>
    </section>
  );
}
