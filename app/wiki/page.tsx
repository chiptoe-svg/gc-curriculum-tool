import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidSlug } from '@/lib/slug';
import { readWikiPage } from '@/lib/wiki/git-ops';
import { FeedbackLink } from '@/app/FeedbackLink';
import { AskTab } from '@/components/AskTab';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function WikiIndexPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;
  // Public read-only since 2026-09-25 (see PUBLIC_PREFIXES). The slug is no
  // longer a gate: a valid one unlocks the faculty nav + embedded Ask chat;
  // without it the page renders read-only with public links only.
  const faculty = isValidSlug(slug);
  const q = faculty ? `?slug=${encodeURIComponent(slug)}` : '';

  const raw = await readWikiPage('index.md');
  const isEmpty = !raw || raw.trim().length === 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              GC · Knowledge base
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              Curriculum Wiki
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {faculty && (
              <>
                <Link
                  href={`/program${q}`}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Program →
                </Link>
                <Link
                  href={`/courses${q}`}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Courses →
                </Link>
                <Link
                  href={`/ask${q}`}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  💬 Ask
                </Link>
              </>
            )}
            <Link
              href={`/${q}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Hub
            </Link>
            {faculty && <FeedbackLink />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {isEmpty ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-muted-foreground">
              No pages yet. They appear here once a course profile is approved.
            </p>
            {faculty && (
              <Link
                href={`/courses${q}`}
                className="mt-4 inline-block text-sm text-blue-700 hover:underline"
              >
                Go to Courses →
              </Link>
            )}
          </div>
        ) : (
          <article className="wiki-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{raw}</ReactMarkdown>
          </article>
        )}

        {faculty && (
          <div className="mt-10 border-t pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Or just ask — the curriculum chat reads the same pages and cites them back as you go.
            </p>
            <AskTab slug={slug} />
          </div>
        )}
      </main>
    </div>
  );
}
