import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidSlug } from '@/lib/slug';
import { readWikiPage } from '@/lib/wiki/git-ops';
import { parseFrontmatter, resolveWikilinks } from '@/lib/wiki/markdown-helpers';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['courses', 'competencies', 'targets', 'concepts'] as const;
type WikiType = (typeof ALLOWED_TYPES)[number];

function isAllowedType(t: string): t is WikiType {
  return (ALLOWED_TYPES as readonly string[]).includes(t);
}

/** Defensive slug check — alphanumeric + hyphen only, no slashes or dots. */
function isValidWikiSlug(s: string): boolean {
  return /^[a-z0-9-]+$/.test(s);
}

interface Props {
  params: Promise<{ type: string; slug: string }>;
  searchParams: Promise<{ slug?: string }>;
}

export default async function WikiPage({ params, searchParams }: Props) {
  const { type, slug: pageSlug } = await params;
  const { slug = '' } = await searchParams;

  // Slug gate (same pattern as /program / /courses).
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

  // Validate type — 404 for anything outside the allowed set.
  if (!isAllowedType(type)) {
    notFound();
  }

  // Defensive slug validation — single path segment, alphanumeric + hyphen.
  if (!isValidWikiSlug(pageSlug)) {
    notFound();
  }

  const raw = await readWikiPage(`${type}/${pageSlug}.md`);

  // File doesn't exist yet (course not audited / approved).
  if (raw === null) {
    notFound();
  }

  const { frontmatter, body } = parseFrontmatter(raw);
  const title = frontmatter.title ?? pageSlug;

  // Pre-process wikilinks before react-markdown sees the string.
  const processedBody = resolveWikilinks(body, slug);

  // Capitalise type label for breadcrumb.
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4 px-6 py-4">
          {/* Breadcrumb */}
          <nav className="flex items-baseline gap-1.5 text-sm text-muted-foreground">
            <Link
              href={`/wiki?slug=${encodeURIComponent(slug)}`}
              className="hover:text-foreground"
            >
              Wiki
            </Link>
            <span>/</span>
            <span>{typeLabel}</span>
            <span>/</span>
            <span className="font-medium text-foreground">{title}</span>
          </nav>

          {/* Back link */}
          <Link
            href={`/wiki?slug=${encodeURIComponent(slug)}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Wiki index
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <article className="wiki-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {processedBody}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
