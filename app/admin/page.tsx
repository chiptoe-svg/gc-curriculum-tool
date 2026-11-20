import Link from 'next/link';
import { SandboxGrantsPanel } from './SandboxGrantsPanel';
import { listSandboxCourses } from '@/lib/sandbox/courses';

import './admin.css';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function AdminPage({ searchParams }: Props) {
  // Faculty Basic Auth (middleware) is the primary gate; the admin second
  // factor is the slug, passed to the panel's API calls (matches /admin/partners).
  const { slug } = await searchParams;
  if (!slug) {
    return <main className="ad ad-main"><p className="ad-meta">Missing slug query param.</p></main>;
  }
  const sandboxCourses = (await listSandboxCourses()).map(c => ({ code: c.code, title: c.title }));
  const q = encodeURIComponent(slug);
  return (
    <div className="ad min-h-screen bg-background">
      <header className="ad-header">
        <div className="ad-header-inner">
          <div>
            <p className="ad-eyebrow">Admin</p>
            <h1 className="ad-title">Admin</h1>
            <p className="ad-lede">Operator tools.</p>
          </div>
          <nav className="ad-nav">
            <Link href={`/admin/access?slug=${q}`} className="ad-btn">Faculty access</Link>
            <Link href={`/admin/partners?slug=${q}`} className="ad-btn">Partners</Link>
            <Link href="/admin/synthesis" className="ad-btn">Synthesis</Link>
            <Link href={`/admin/bundles?slug=${q}`} className="ad-btn">Skill bundles</Link>
            <Link href={`/admin/membership?slug=${q}`} className="ad-btn">Career target competencies</Link>
            <Link href={`/settings?slug=${q}`} className="ad-btn">Settings</Link>
          </nav>
        </div>
      </header>
      <main className="ad-main">
        <SandboxGrantsPanel slug={slug} sandboxCourses={sandboxCourses} />
      </main>
    </div>
  );
}
