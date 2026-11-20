import Link from 'next/link';
import { AccessPanel } from './AccessPanel';
import { listCourses } from '@/lib/db/courses-queries';

import '../admin.css';

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
    return <main className="ad ad-main"><p className="ad-meta">Missing slug query param.</p></main>;
  }
  const courseList = (await listCourses()).map((c) => ({ code: c.code, title: c.title }));
  return (
    <div className="ad min-h-screen bg-background">
      <header className="ad-header">
        <div className="ad-header-inner">
          <div>
            <p className="ad-eyebrow">Admin</p>
            <h1 className="ad-title">Faculty access</h1>
          </div>
          <nav className="ad-nav">
            <Link href={`/admin?slug=${encodeURIComponent(slug)}`} className="ad-btn">← Admin</Link>
          </nav>
        </div>
      </header>
      <main className="ad-main">
      <AccessPanel slug={slug} courses={courseList} />
      </main>
    </div>
  );
}
