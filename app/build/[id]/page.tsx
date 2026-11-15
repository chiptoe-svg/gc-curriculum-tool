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

  return (
    <Builder
      planId={plan.id}
      slug={slug}
      library={library}
      initialName={plan.name}
      // A plan saved by an older build may lack newer fields: fill them from the empty plan.
      initialState={parsePlanState({ ...EMPTY_PLAN, ...plan.state }) ?? EMPTY_PLAN}
      initialVersion={plan.version}
      lastEditedBy={plan.updatedBy}
      knownName={personalName(grant)}
    />
  );
}
