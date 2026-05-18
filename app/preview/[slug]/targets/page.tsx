import { notFound } from 'next/navigation';
import { isValidSlug } from '@/lib/slug';
import { listTargets } from '@/lib/db/career-targets-queries';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function TargetsListPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();

  const targets = await listTargets();

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}`} className="underline underline-offset-2 hover:text-foreground">
          &larr; Back to prototype
        </Link>
      </div>

      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">Career Targets</h1>
        <p className="text-muted-foreground leading-relaxed max-w-2xl">
          These are the five career destination areas. Panel members and Chip can edit these definitions;
          changes take effect immediately on all subsequent analyses. The sub-competencies and their
          Know / Understand / Do descriptors define exactly what the AI scores coverage against.
        </p>
      </header>

      <div className="space-y-4">
        {targets.map((t) => (
          <div
            key={t.id}
            className="rounded-lg border bg-card p-5 flex items-start justify-between gap-6"
          >
            <div className="space-y-1 min-w-0">
              <h2 className="text-base font-semibold">{t.name}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                {t.shortDefinition}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t.subCompetencies.length} sub-competenc{t.subCompetencies.length === 1 ? 'y' : 'ies'}
              </p>
            </div>
            <Link
              href={`/preview/${slug}/targets/${t.id}`}
              className="shrink-0 inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Edit
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}
