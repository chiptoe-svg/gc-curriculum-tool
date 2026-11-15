import { headers } from 'next/headers';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { getRequestGrant, personalName } from '@/lib/auth/viewer';
import { listPlans } from '@/lib/db/curriculum-plan-queries';
import { canManageWhatIf } from '@/lib/what-if/ownership';
import { NewPlan } from './NewPlan';
import { DeletePlan } from './DeletePlan';
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
  const plans = await listPlans();
  const q = `?slug=${encodeURIComponent(slug)}`;
  const when = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="cb cb-index">
      <header className="cb-index__head">
        <Link href={`/${q}`} className="cb-back">Curriculum</Link>
        <h1>Curriculum builder</h1>
        <p>
          Stack courses across the three acts and watch how they build toward a career path. Set the Know, Understand and Do
          level each competency should reach by the end of Act 1, 2 and 3, then see which targets the stack reaches, which it
          misses, and which it reaches once and lets fade. A plan never changes a real course.
        </p>
      </header>

      <NewPlan slug={slug} knownName={personalName(grant)} />

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
    </div>
  );
}
