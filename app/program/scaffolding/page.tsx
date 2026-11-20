import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { ScaffoldingStripClient } from './ScaffoldingStripClient';
import { FeedbackLink } from '@/app/FeedbackLink';

import '../program.css';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string; target?: string }>;
}

export default async function ScaffoldingPage({ searchParams }: Props) {
  const { slug = '', target = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="pg-title">Access link required</h1>
        <p className="pg-meta mt-3">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  const targets = await db.select({ id: careerTargets.id, name: careerTargets.name }).from(careerTargets).orderBy(asc(careerTargets.name));

  return (
    <div className="min-h-screen bg-background">
      <header className="pg-header">
        <div className="pg-header-inner">
          <div>
            <p className="pg-eyebrow">Phase 1B · Scaffolding</p>
            <h1 className="pg-title">GC Program — Scaffolding Strip</h1>
          </div>
          <div className="pg-nav">
            <Link href={`/program?slug=${encodeURIComponent(slug)}`} className="pg-btn">← Coverage matrix</Link>
            <Link href={`/ask?slug=${encodeURIComponent(slug)}`} className="pg-btn">💬 Ask</Link>
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="pg-btn">Hub</Link>
            <FeedbackLink />
          </div>
        </div>
      </header>
      <main className="pg-main">
        <ScaffoldingStripClient slug={slug} targets={targets} selectedTargetId={target || (targets[0]?.id ?? '')} />
      </main>
    </div>
  );
}
