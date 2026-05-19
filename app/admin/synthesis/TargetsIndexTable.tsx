'use client';

import Link from 'next/link';

export interface IndexRow {
  id: string;
  name: string;
  shortDefinition: string;
  submissions: number;
  partners: number;
  stale: boolean;
  staleReason?: 'no_run' | 'new_submissions' | 'age';
  lastRunAt: string | null;
}

const REASON_LABEL: Record<NonNullable<IndexRow['staleReason']>, string> = {
  no_run: 'No run yet',
  new_submissions: 'New submissions',
  age: 'Run > 30 days old',
};

export function TargetsIndexTable({ rows, slug }: { rows: IndexRow[]; slug: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No career targets configured.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="text-left text-xs uppercase text-slate-500">
        <tr>
          <th className="py-2">Career target</th>
          <th>Submissions</th>
          <th>Partners</th>
          <th>Last run</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-t border-slate-200">
            <td className="py-3">
              <Link href={`/admin/synthesis/targets/${r.id}?slug=${slug}`} className="font-medium text-blue-700 hover:underline">
                {r.name}
              </Link>
              <div className="text-xs text-slate-500">{r.shortDefinition}</div>
            </td>
            <td>{r.submissions}</td>
            <td>{r.partners}</td>
            <td className="text-xs">{r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : '—'}</td>
            <td>
              {r.stale ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {r.staleReason ? REASON_LABEL[r.staleReason] : 'Stale'}
                </span>
              ) : (
                <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Fresh</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
