import Link from 'next/link';
import { MembershipPanel } from './MembershipPanel';

// P3 membership addendum (spec 2026-10-21-p3-membership-from-weights-design.md §5).
// Faculty Basic Auth (middleware) is the primary gate; the admin second factor
// is the slug, passed to the panel's API calls (matches /admin/bundles).
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function MembershipPage({ searchParams }: Props) {
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Career target competencies</h1>
        <p className="text-sm text-slate-600">
          <Link href={`/admin?slug=${encodeURIComponent(slug)}`} className="text-blue-700 underline">Admin</Link>
        </p>
      </header>
      <MembershipPanel slug={slug} />
    </main>
  );
}
