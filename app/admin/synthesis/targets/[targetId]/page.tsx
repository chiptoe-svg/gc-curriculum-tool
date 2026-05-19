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
import { HeaderStats } from './HeaderStats';
import { SynthesizedInsightsPanel } from './SynthesizedInsightsPanel';
import { ProposedKUDEditsPanel } from './ProposedKUDEditsPanel';
import { ReRunButton } from './ReRunButton';

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

  const [submissions, partnersCount, weightedSum, salary, unmapped, staleness, latestRun] = await Promise.all([
    countSubmittedForTarget(targetId),
    countUniquePartnersForTarget(targetId),
    sumPartnerWeightsForTarget(targetId),
    salaryDistributionForTarget(targetId),
    nearbyUnmappedLabelsForTarget(targetId),
    stalenessCheck(targetId),
    getLatestRun(targetId),
  ]);

  const result = latestRun?.result as SynthesisResult | undefined;

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
    </main>
  );
}
