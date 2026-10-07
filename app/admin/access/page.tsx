import Link from 'next/link';
import { AccessPanel } from './AccessPanel';
import { listCourses } from '@/lib/db/courses-queries';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AccessPage({ searchParams }: Props) {
  // Faculty Basic Auth (middleware) is the primary gate; the admin second
  // factor is the slug, passed to the panel's API calls (matches /admin and
  // /admin/partners).
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }
  const courseList = (await listCourses()).map((c) => ({ code: c.code, title: c.title }));
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Faculty access</h1>
        <p className="text-sm text-slate-600">
          <Link href={`/admin?slug=${encodeURIComponent(slug)}`} className="text-blue-700 underline">Admin</Link>
        </p>
      </header>
      <AccessPanel slug={slug} courses={courseList} />
    </main>
  );
}
