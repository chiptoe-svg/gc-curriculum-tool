import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { ScaffoldingStripClient } from './ScaffoldingStripClient';
import { FeedbackLink } from '@/app/FeedbackLink';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string; target?: string }>;
}

export default async function ScaffoldingPage({ searchParams }: Props) {
  const { slug = '', target = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  const targets = await db.select({ id: careerTargets.id, name: careerTargets.name }).from(careerTargets).orderBy(asc(careerTargets.name));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Phase 1B · Scaffolding</p>
            <h1 className="mt-0.5 text-xl font-semibold">GC Program — Scaffolding Strip</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/program?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">← Coverage matrix</Link>
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Hub</Link>
            <FeedbackLink />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">
        <ScaffoldingStripClient slug={slug} targets={targets} selectedTargetId={target || (targets[0]?.id ?? '')} />
      </main>
    </div>
  );
}
