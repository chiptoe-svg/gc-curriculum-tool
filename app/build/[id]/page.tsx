import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { getRequestGrant, personalName } from '@/lib/auth/viewer';
import { getPlan } from '@/lib/db/curriculum-plan-queries';
import { loadLibrary } from '@/lib/builder/library';
import { parsePlanState } from '@/lib/builder/plan-schema';
import { EMPTY_PLAN } from '@/lib/builder/types';
import { Builder } from './Builder';
import '../build.css';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BuildPlanPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ slug?: string }>;
}) {
  const { id } = await params;
  const { slug = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  if (!UUID.test(id)) notFound();
  const [plan, library, grant] = await Promise.all([getPlan(id), loadLibrary(), getRequestGrant(await headers())]);
  if (!plan) notFound();
  // A plan saved by an older build may lack newer fields: fill them from the empty plan. If it still cannot
  // be read, say so and stop: opening it as an empty plan would let the first edit overwrite it.
  const stored = (plan.state ?? {}) as Partial<typeof EMPTY_PLAN>;
  const state = parsePlanState({ ...EMPTY_PLAN, ...stored, goal: { ...EMPTY_PLAN.goal, ...(stored.goal ?? {}) } });
  if (!state) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">This plan cannot be opened</h1>
        <p className="mt-3 text-muted-foreground">“{plan.name}” was saved in a form this version of the builder cannot read. It has not been changed. Tell the site administrator.</p>
      </div>
    );
  }

  return (
    <Builder
      planId={plan.id}
      slug={slug}
      library={library}
      initialName={plan.name}
      initialState={state}
      initialVersion={plan.version}
      lastEditedBy={plan.updatedBy}
      knownName={personalName(grant)}
    />
  );
}
