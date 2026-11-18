import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { getRequestGrant, personalName } from '@/lib/auth/viewer';
import { StartStringCluster } from './StartStringCluster';
import '../../build.css';

export const dynamic = 'force-dynamic';

const MAX_COURSES = 40;

/** /build/clusters/new?courses=GC 1010,GC 2070: a cluster that opens with those courses on it (the link from a string's page). */
export default async function NewClusterFromCourses({ searchParams }: { searchParams: Promise<{ slug?: string; courses?: string }> }) {
  const { slug = '', courses = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  const codes = [...new Set(courses.split(',').map(c => c.trim()).filter(Boolean))].slice(0, MAX_COURSES);
  const grant = await getRequestGrant(await headers());
  return <StartStringCluster slug={slug} codes={codes} knownName={personalName(grant)} />;
}
