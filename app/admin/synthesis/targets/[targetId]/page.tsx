import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  countSubmittedForTarget,
  countUniquePartnersForTarget,
  sumPartnerWeightsForTarget,
  salaryDistributionForTarget,
  nearbyUnmappedLabelsForTarget,
} from '@/lib/ai/synthesis/queries';
import { stalenessCheck } from '@/lib/ai/synthesis/staleness';
import { getLatestRun } from '@/lib/ai/synthesis/orchestrator';
import type { SynthesisResult } from '@/lib/ai/synthesis/schema';
import {
  listSubmittedPositionsForTarget,
  getAggregateForTarget,
} from '@/lib/db/position-capture-queries';
import { HeaderStats } from './HeaderStats';
import { SynthesizedInsightsPanel } from './SynthesizedInsightsPanel';
import { ProposedKUDEditsPanel } from './ProposedKUDEditsPanel';
import { ReRunButton } from './ReRunButton';
import { AggregatePanel } from './AggregatePanel';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ targetId: string }>;
  searchParams: Promise<{ slug?: string }>;
}

export default async function SynthesisTargetPage({ params, searchParams }: Props) {
  const [{ targetId }, { slug }] = await Promise.all([params, searchParams]);
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }

  const rows = await db.select().from(careerTargets).where(eq(careerTargets.id, targetId)).limit(1);
  const target = rows[0];
  if (!target) return notFound();

  const [submissions, partnersCount, weightedSum, salary, unmapped, staleness, latestRun, positions, aggregate] = await Promise.all([
    countSubmittedForTarget(targetId),
    countUniquePartnersForTarget(targetId),
    sumPartnerWeightsForTarget(targetId),
    salaryDistributionForTarget(targetId),
    nearbyUnmappedLabelsForTarget(targetId),
    stalenessCheck(targetId),
    getLatestRun(targetId),
    listSubmittedPositionsForTarget(targetId),
    getAggregateForTarget(targetId),
  ]);

  const result = latestRun?.result as SynthesisResult | undefined;

  const completenessLabel: Record<string, string> = {
    'title-only': 'Title only',
    structured: 'Structured',
    rated: 'Rated',
    interviewed: 'Interviewed',
  };

  const completenessColor: Record<string, string> = {
    'title-only': 'bg-slate-100 text-slate-600',
    structured: 'bg-blue-100 text-blue-700',
    rated: 'bg-violet-100 text-violet-700',
    interviewed: 'bg-green-100 text-green-700',
  };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Career target</div>
          <h1 className="mt-1 text-2xl font-semibold">{target.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{target.shortDefinition}</p>
        </div>
        <ReRunButton
          targetId={targetId}
          slug={slug}
          stale={staleness.stale}
          submissionsAvailable={submissions > 0}
          lastRunCostCents={latestRun?.costUsdCents ?? null}
        />
      </header>

      <HeaderStats
        submissions={submissions}
        partners={partnersCount}
        weightedSum={weightedSum}
        salary={salary}
        unmapped={unmapped}
      />

      {!result ? (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          {submissions === 0
            ? 'No submissions yet. Once partners respond, run synthesis to see proposed KUD edits and aggregated themes.'
            : 'No synthesis run yet for this target. Click "Run synthesis" above.'}
        </div>
      ) : (
        <>
          <SynthesizedInsightsPanel result={result} />
          <ProposedKUDEditsPanel
            target={{
              knowDescriptors: target.knowDescriptors,
              understandDescriptors: target.understandDescriptors,
              doDescriptors: target.doDescriptors,
            }}
            edits={result.proposedKUDEdits}
          />
        </>
      )}

      <AggregatePanel
        targetId={targetId}
        slug={slug}
        initialMarkdown={aggregate?.markdown ?? null}
        initialStale={aggregate?.stale ?? false}
        initialGeneratedAt={aggregate?.generatedAt ?? null}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Positions in this target ({positions.length})</h2>
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submitted positions yet.</p>
        ) : (
          <div className="overflow-hidden rounded border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Company</th>
                  <th className="px-4 py-2 text-left">Title</th>
                  <th className="px-4 py-2 text-left">Completeness</th>
                  <th className="px-4 py-2 text-left">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {positions.map(pos => (
                  <tr key={pos.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">{pos.company}</td>
                    <td className="px-4 py-2 text-slate-700">{pos.positionTitle ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-2">
                      {pos.completeness ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${completenessColor[pos.completeness] ?? 'bg-slate-100 text-slate-600'}`}>
                          {completenessLabel[pos.completeness] ?? pos.completeness}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {pos.submittedAt ? new Date(pos.submittedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
