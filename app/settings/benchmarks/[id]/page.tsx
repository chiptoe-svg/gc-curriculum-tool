import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidSlug } from '@/lib/slug';
import { getEvidence } from '@/lib/settings/evidence';

import '../../settings.css';

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
      <header className="st-header">
        <div className="st-header-inner st-narrow">
          <div>
            <p className="st-eyebrow">Benchmark · {e.date}</p>
            <h1 className="st-title">{e.title}</h1>
          </div>
          <div className="st-nav">
            <Link href={back} className="st-btn">← Settings</Link>
          </div>
        </div>
      </header>
      <main className="st-main st-narrow st-stack">
        <p className="st-summary">{e.summary}</p>
        <article className="wiki-prose text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.body}</ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
