import Link from 'next/link';
import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { getMatrixData, listStaleSnapshots } from '@/lib/db/program-coverage-queries';
import { ProgramCoverageClient } from './ProgramCoverageClient';
import { FeedbackLink } from '@/app/FeedbackLink';
import { listFlags } from '@/lib/db/flag-queries';
import { getViewerAccess } from '@/lib/auth/viewer';

import './program.css';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function ProgramPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="pg-title">Access link required</h1>
        <p className="pg-meta mt-3">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }

  const { isAdmin } = await getViewerAccess(await headers());
  const data = await getMatrixData();
  // I-2 (hostile-review fix wave): the bulk-refresh button's label must
  // state the real work — one AI call per stale SNAPSHOT, not a matrix
  // pair count (see lib/program/stale-pairs.ts's staleSnapshotButtonLabel).
  const staleSnapshotCount = (await listStaleSnapshots()).length;
  const flagRows = await listFlags({});
  // Server-side: no drift annotation needed for first paint (the client
  // refetches via /api/flags after any mutation, which annotates).
  const initialFlags = flagRows.map(f => ({
    ...f,
    createdAt: f.createdAt.toISOString(),
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
    drift: null,
    stillInMatrix: null,
    // flaggedContext from DB is FlaggedContext | null | undefined; cast to the
    // narrower AnnotatedFlag shape (k/u/d only) since FlaggedContext is a superset.
    flaggedContext: f.flaggedContext
      ? { k: f.flaggedContext.k ?? null, u: f.flaggedContext.u ?? null, d: f.flaggedContext.d ?? null }
      : null,
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="pg-header">
        <div className="pg-header-inner">
          <div>
            <p className="pg-eyebrow">Program Coverage · v1</p>
            <h1 className="pg-title">GC Program — Coverage Matrix</h1>
          </div>
          <div className="pg-nav">
            <Link href={`/courses?slug=${encodeURIComponent(slug)}`} className="pg-btn">Courses →</Link>
            <Link href={`/program/scaffolding?slug=${encodeURIComponent(slug)}`} className="pg-btn">Scaffolding view →</Link>
            <a href="https://tonkin.people.clemson.edu/pages/gc-curriculum/curriculum-map.html" target="_blank" rel="noopener noreferrer" className="pg-btn">Curriculum map ↗</a>
            <Link href={`/wiki?slug=${encodeURIComponent(slug)}`} className="pg-btn">Wiki →</Link>
            <Link href={`/ask?slug=${encodeURIComponent(slug)}`} className="pg-btn">💬 Ask</Link>
            <Link href={`/settings?slug=${encodeURIComponent(slug)}`} className="pg-btn">Settings</Link>
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="pg-btn">← Hub</Link>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="pg-main">
        <ProgramCoverageClient slug={slug} initialData={data} initialStaleSnapshotCount={staleSnapshotCount} initialFlags={initialFlags} isAdmin={isAdmin} />
      </main>
    </div>
  );
}
