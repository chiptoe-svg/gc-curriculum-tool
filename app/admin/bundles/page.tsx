import Link from 'next/link';
import { BundlesPanel } from './BundlesPanel';
import { ONET_ATTRIBUTION } from '@/lib/db/bundle-queries';

import '../admin.css';

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
    return <main className="ad ad-main"><p className="ad-meta">Missing slug query param.</p></main>;
  }
  return (
    <div className="ad min-h-screen bg-background">
      <header className="ad-header">
        <div className="ad-header-inner">
          <div>
            <p className="ad-eyebrow">Admin</p>
            <h1 className="ad-title">Skill bundles</h1>
          </div>
          <nav className="ad-nav">
            <Link href={`/admin?slug=${encodeURIComponent(slug)}`} className="ad-btn">← Admin</Link>
          </nav>
        </div>
      </header>
      <main className="ad-main">
      <BundlesPanel slug={slug} />
      <footer className="ad-foot">{ONET_ATTRIBUTION}</footer>
      </main>
    </div>
  );
}
