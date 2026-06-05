import Link from 'next/link';
import type { PositionCaptureRow } from '@/lib/db/position-capture-queries';

interface TargetOption {
  id: string;
  name: string;
}

interface Props {
  partner: { firstName: string; company: string };
  token: string;
  positions: PositionCaptureRow[];
  targets: TargetOption[];
}

function resumeStep(c: string | null): number {
  switch (c) {
    case 'interviewed':
    case 'rated': return 6;
    case 'structured': return 5;
    case 'title-only': return 2;
    default: return 1;
  }
}

export function PartnerDashboard({ partner, token, positions, targets }: Props) {
  const targetMap = new Map(targets.map(t => [t.id, t.name]));

  // Group positions by career target
  const grouped = new Map<string, PositionCaptureRow[]>();
  for (const p of positions) {
    const list = grouped.get(p.careerTargetId) ?? [];
    list.push(p);
    grouped.set(p.careerTargetId, list);
  }

  const drafts = positions.filter(p => p.status === 'draft');
  const submitted = positions.filter(p => p.status === 'submitted');

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-500">Welcome back, {partner.firstName} ({partner.company}).</p>
        <h1 className="mt-1 text-2xl font-semibold">Your survey</h1>
      </div>

      {/* Stats summary row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500">Positions</div>
          <div className="mt-1 text-lg font-medium">
            {submitted.length} submitted{drafts.length > 0 ? ` · ${drafts.length} draft` : ''}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 opacity-60">
          <div className="text-xs uppercase tracking-wide text-slate-500">Project ratings</div>
          <div className="mt-1 text-lg font-medium">Coming soon</div>
        </div>
        <Link
          href={`/partners/${encodeURIComponent(token)}/done`}
          className="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-slate-600 hover:border-slate-400"
        >
          <div className="mt-3 text-sm">I&apos;m done for now →</div>
        </Link>
      </div>

      {/* Primary CTA */}
      <div>
        <Link
          href={`/partners/${encodeURIComponent(token)}/positions/new`}
          className="inline-flex items-center rounded-lg border border-blue-600 bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add a position →
        </Link>
      </div>

      {/* Positions list, grouped by career target */}
      {positions.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">Your positions</h2>
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([targetId, rows]) => (
              <div key={targetId}>
                <div className="mb-2 text-sm font-semibold text-slate-700">
                  {targetMap.get(targetId) ?? targetId}
                </div>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                  {rows.map(pos => (
                    <div key={pos.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {pos.positionTitle ?? <span className="text-slate-400 italic">Untitled draft</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          {pos.status === 'submitted' ? (
                            <>
                              <CompletenessTag completeness={pos.completeness} />
                              {pos.submittedAt && (
                                <span>Submitted {new Date(pos.submittedAt).toLocaleDateString()}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Draft</span>
                              <CompletenessTag completeness={pos.completeness} />
                            </>
                          )}
                        </div>
                      </div>
                      {pos.status === 'draft' && (
                        <Link
                          href={`/partners/${encodeURIComponent(token)}/positions/${pos.id}/page/${resumeStep(pos.completeness)}`}
                          className="ml-4 shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                        >
                          Resume draft
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CompletenessTag({ completeness }: { completeness: PositionCaptureRow['completeness'] }) {
  if (!completeness) return null;
  const labels: Record<NonNullable<typeof completeness>, string> = {
    'title-only': 'Title only',
    structured: 'Structured',
    rated: 'Skills rated',
    interviewed: 'Interviewed',
  };
  const colors: Record<NonNullable<typeof completeness>, string> = {
    'title-only': 'bg-slate-100 text-slate-600',
    structured: 'bg-blue-100 text-blue-700',
    rated: 'bg-purple-100 text-purple-700',
    interviewed: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 ${colors[completeness]}`}>
      {labels[completeness]}
    </span>
  );
}
