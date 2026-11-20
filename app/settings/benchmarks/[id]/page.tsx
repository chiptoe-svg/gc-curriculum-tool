import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidSlug } from '@/lib/slug';
import { getEvidence } from '@/lib/settings/evidence';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ slug?: string }>;
}

/** One entry of the evidence register (docs/benchmarks/<id>.md), linked from /settings. */
export default async function BenchmarkPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { slug = '' } = await searchParams;
  const e = getEvidence(id);
  if (!e) notFound();
  const back = isValidSlug(slug) ? `/settings?slug=${encodeURIComponent(slug)}` : '/settings';
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Benchmark · {e.date}</p>
            <h1 className="mt-0.5 text-xl font-semibold">{e.title}</h1>
          </div>
          <Link href={back} className="text-sm text-muted-foreground hover:text-foreground">← Settings</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-6 space-y-4">
        <p className="rounded-md border bg-card px-4 py-3 text-sm">{e.summary}</p>
        <article className="wiki-prose text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.body}</ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
