import Link from 'next/link';
import { SandboxGrantsPanel } from './SandboxGrantsPanel';
import { listSandboxCourses } from '@/lib/sandbox/courses';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AdminPage({ searchParams }: Props) {
  // Faculty Basic Auth (middleware) is the primary gate; the admin second
  // factor is the slug, passed to the panel's API calls (matches /admin/partners).
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="p-8"><p className="text-sm text-slate-600">Missing slug query param.</p></main>;
  }
  const sandboxCourses = (await listSandboxCourses()).map(c => ({ code: c.code, title: c.title }));
  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-slate-600">
          Operator tools.{' '}
          <Link href={`/admin/partners?slug=${encodeURIComponent(slug)}`} className="text-blue-700 underline">Partners</Link>
          {' · '}
          <Link href="/admin/synthesis" className="text-blue-700 underline">Synthesis</Link>
        </p>
      </header>
      <SandboxGrantsPanel slug={slug} sandboxCourses={sandboxCourses} />
    </main>
  );
}
