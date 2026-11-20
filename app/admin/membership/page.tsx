import Link from 'next/link';
import { MembershipPanel } from './MembershipPanel';

import '../admin.css';

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
    return <main className="ad ad-main"><p className="ad-meta">Missing slug query param.</p></main>;
  }
  return (
    <div className="ad min-h-screen bg-background">
      <header className="ad-header">
        <div className="ad-header-inner">
          <div>
            <p className="ad-eyebrow">Admin</p>
            <h1 className="ad-title">Career target competencies</h1>
          </div>
          <nav className="ad-nav">
            <Link href={`/admin?slug=${encodeURIComponent(slug)}`} className="ad-btn">← Admin</Link>
          </nav>
        </div>
      </header>
      <main className="ad-main">
      <MembershipPanel slug={slug} />
      </main>
    </div>
  );
}
