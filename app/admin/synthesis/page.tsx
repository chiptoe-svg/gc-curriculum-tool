import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import {
  countSubmittedForTarget,
  countUniquePartnersForTarget,
} from '@/lib/ai/synthesis/queries';
import { stalenessCheck } from '@/lib/ai/synthesis/staleness';
import { getLatestRun } from '@/lib/ai/synthesis/orchestrator';
import { TargetsIndexTable, type IndexRow } from './TargetsIndexTable';

import '../admin.css';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function SynthesisIndexPage({ searchParams }: Props) {
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="ad ad-main"><p className="ad-meta">Missing slug query param.</p></main>;
  }

  const targets = await db.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder));

  const rows: IndexRow[] = await Promise.all(
    targets.map(async t => {
      const [submissions, partners, staleness, latest] = await Promise.all([
        countSubmittedForTarget(t.id),
        countUniquePartnersForTarget(t.id),
        stalenessCheck(t.id),
        getLatestRun(t.id),
      ]);
      return {
        id: t.id,
        name: t.name,
        shortDefinition: t.shortDefinition,
        submissions,
        partners,
        stale: staleness.stale,
        staleReason: staleness.reason,
        lastRunAt: latest?.createdAt ? latest.createdAt.toISOString() : null,
      };
    })
  );

  return (
    <div className="ad min-h-screen bg-background">
      <header className="ad-header">
        <div className="ad-header-inner">
          <div>
            <p className="ad-eyebrow">Admin</p>
            <h1 className="ad-title">Industry partner synthesis</h1>
            <p className="ad-lede">
              Aggregated insights and proposed KUD edits per career target. Faculty reviews and curates;
              the tool never auto-writes to the curriculum.
            </p>
          </div>
        </div>
      </header>
      <main className="ad-main">
        <TargetsIndexTable rows={rows} slug={slug} />
      </main>
    </div>
  );
}
