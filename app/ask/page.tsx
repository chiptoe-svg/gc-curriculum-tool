import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { AskTab } from '@/components/AskTab';
import { FeedbackLink } from '@/app/FeedbackLink';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AskPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;

  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">
          Open this page through the access link your administrator shared.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              GC · Curriculum chat
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
              Ask the curriculum
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/wiki?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">
              Wiki →
            </Link>
            <Link href={`/courses?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">
              Courses
            </Link>
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">
              ← Hub
            </Link>
            <FeedbackLink />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-6">
        <p className="mb-4 text-sm text-muted-foreground">
          Program-level questions across courses, competencies, career targets, and concepts. Answers come from the <Link href={`/wiki?slug=${encodeURIComponent(slug)}`} className="underline hover:text-foreground">curriculum wiki</Link> with inline page citations. If you want to chat anchored to a specific course, use the <strong>💬 Ask</strong> link on that course&apos;s row in <Link href={`/courses?slug=${encodeURIComponent(slug)}`} className="underline hover:text-foreground">/courses</Link> or its Explore page.
        </p>
        <AskTab slug={slug} />
      </main>
    </div>
  );
}
