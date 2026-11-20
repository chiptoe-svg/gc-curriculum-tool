import { headers } from 'next/headers';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getRequestGrant, personalName } from '@/lib/auth/viewer';
import { listPlans } from '@/lib/db/curriculum-plan-queries';
import { listClusters } from '@/lib/db/cluster-queries';
import { isUndefinedTable } from '@/lib/db/pg-errors';
import { canManageWhatIf } from '@/lib/what-if/ownership';
import { NewPlan } from './NewPlan';
import { PLAN_YEARS } from '@/lib/builder/degree-data';
import { DeletePlan } from './DeletePlan';
import { NewCluster } from './NewCluster';
import './build.css';

export const dynamic = 'force-dynamic';

export default async function BuildIndex({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const { slug = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  const grant = await getRequestGrant(await headers());
  // Clusters need migration 0070; on a database without it, the page lists plans only.
  const [plans, clusters] = await Promise.all([listPlans(), listClusters().catch((err: unknown) => {
    if (isUndefinedTable(err)) return [];
    throw err;
  })]);
  const q = `?slug=${encodeURIComponent(slug)}`;
  const when = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="cb cb-index">
      <header className="cb-index__head">
        <Link href={`/${q}`} className="cb-back">Curriculum</Link>
        <h1>Curriculum builder</h1>
        <p>
          Stack courses across the three acts and watch how they build toward a career path. Set the Know, Understand and Do
          level each competency should reach by the end of Act 1, 2 and 3, then see which targets the stack reaches and which it
          misses. A plan never changes a real course.
        </p>
      </header>

      <p><Link href={`/build/tree${q}`}>Department skill tree</Link>: every competency with what the courses reach under it, and the program&rsquo;s reading for each career path.</p>

      <NewPlan slug={slug} knownName={personalName(grant)} years={PLAN_YEARS} />

      <section className="cb-index__list">
        <h2>Plans</h2>
        {plans.length === 0 ? (
          <p className="cb-empty">No plans yet. Start one above; everyone with faculty access can open and edit it.</p>
        ) : (
          <ul>
            {plans.map(p => (
              <li key={p.id}>
                <Link href={`/build/${p.id}${q}`} className="cb-index__plan">
                  <span className="cb-index__name">{p.name}</span>
                  <span className="cb-index__meta">
                    {p.courses} {p.courses === 1 ? 'course' : 'courses'}, last edited by {p.updatedBy} on {when(p.updatedAt)}
                  </span>
                </Link>
                {grant && canManageWhatIf(grant, p) && <DeletePlan id={p.id} name={p.name} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cb-index__list cb-index__clusters">
        <h2>Clusters</h2>
        <p className="cb-muted">
          A cluster is a small map of related courses, skills only: draw which course comes before which, then see whether
          each course&rsquo;s required skills come from the courses upstream of it and whether the courses together meet the
          cluster&rsquo;s own objectives. A cluster never changes a real course.
        </p>
        <NewCluster slug={slug} knownName={personalName(grant)} />
        {clusters.length === 0 ? (
          <p className="cb-empty">No clusters yet. Start one above; everyone with faculty access can open and edit it.</p>
        ) : (
          <ul>
            {clusters.map(c => (
              <li key={c.id}>
                <Link href={`/build/clusters/${c.id}${q}`} className="cb-index__plan">
                  <span className="cb-index__name">{c.name}</span>
                  <span className="cb-index__meta">
                    {c.courses} {c.courses === 1 ? 'course' : 'courses'}, last edited by {c.updatedBy} on {when(c.updatedAt)}
                  </span>
                </Link>
                {grant && canManageWhatIf(grant, c) && <DeletePlan id={c.id} name={c.name} kind="cluster" />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
