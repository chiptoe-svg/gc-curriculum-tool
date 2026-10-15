import Link from 'next/link';
import { BundlesPanel } from './BundlesPanel';
import { ONET_ATTRIBUTION } from '@/lib/db/bundle-queries';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5, task-12).
// Faculty Basic Auth (middleware) is the primary gate; the admin second
// factor is the slug, passed to the panel's API calls (matches /admin,
// /admin/access and /admin/partners). ONET_ATTRIBUTION is a plain exported
// string constant (no query), so it costs nothing to render here too.
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function BundlesPage({ searchParams }: Props) {
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Skill bundles</h1>
        <p className="text-sm text-slate-600">
          <Link href={`/admin?slug=${encodeURIComponent(slug)}`} className="text-blue-700 underline">Admin</Link>
        </p>
      </header>
      <BundlesPanel slug={slug} />
      <footer className="text-xs text-slate-400">{ONET_ATTRIBUTION}</footer>
    </main>
  );
}
