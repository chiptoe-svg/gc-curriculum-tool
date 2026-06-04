'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';

interface Submission {
  id: string;
  positionTitle: string;
  status: 'draft' | 'submitted';
  updatedAt: string;
  careerTargetId: string | null;
  unmappedTargetLabel: string | null;
}

interface Props {
  /** Optional — when set, the "Resume" link is built as an absolute path
   * `/partners/<token>/submit?draft=…`. When omitted, falls back to a
   * relative `./submit?draft=…` (works inside /partners/<token>/submit,
   * where the trailing-slash semantics resolve correctly). */
  token?: string;
}

export function SubmissionsList({ token }: Props = {}) {
  const [list, setList] = useState<Submission[] | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    fetch('/api/partners/submissions')
      .then(r => r.ok ? r.json() : { submissions: [] })
      .then(j => setList(j.submissions));
  }, []);

  function remove(id: string) {
    if (!confirm('Delete this submission? You can re-create it later.')) return;
    start(async () => {
      const res = await fetch(`/api/partners/submissions/${id}`, { method: 'DELETE' });
      if (res.ok) setList(prev => prev?.filter(s => s.id !== id) ?? null);
    });
  }

  if (list === null) return <p className="text-sm text-slate-500">Loading…</p>;
  if (list.length === 0) return <p className="text-sm text-slate-500">Nothing yet.</p>;

  return (
    <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
      {list.map(s => (
        <li key={s.id} className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="font-medium">{s.positionTitle}</div>
            <div className="text-xs text-slate-500">
              {s.status === 'draft' ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Draft</span>
                                    : <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">Submitted</span>}
              {' · '}updated {new Date(s.updatedAt).toLocaleDateString()}
            </div>
          </div>
          <div className="flex gap-3 text-sm">
            {s.status === 'draft' && (
              <Link
                href={token ? `/partners/${encodeURIComponent(token)}/submit?draft=${s.id}` : `./submit?draft=${s.id}`}
                className="text-blue-700 hover:underline">Resume</Link>
            )}
            <button onClick={() => remove(s.id)} disabled={pending} className="text-red-700 hover:underline disabled:opacity-50">
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
