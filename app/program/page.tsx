import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getMatrixData } from '@/lib/db/program-coverage-queries';
import { ProgramCoverageClient } from './ProgramCoverageClient';
import { FeedbackLink } from '@/app/FeedbackLink';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function ProgramPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }

  const data = await getMatrixData();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Program Coverage · v1</p>
            <h1 className="mt-0.5 text-xl font-semibold">GC Program — Coverage Matrix</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/courses?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Courses →</Link>
            <Link href={`/program/scaffolding?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Scaffolding view →</Link>
            <Link href={`/wiki?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Wiki →</Link>
            <Link href={`/settings?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Settings</Link>
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">← Hub</Link>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <ProgramCoverageClient slug={slug} initialData={data} />
      </main>
    </div>
  );
}
