import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { getRequestGrant, personalName } from '@/lib/auth/viewer';
import { getPlan } from '@/lib/db/curriculum-plan-queries';
import { loadLibrary } from '@/lib/builder/library';
import { parsePlanState } from '@/lib/builder/plan-schema';
import { EMPTY_PLAN, type MatchDecision } from '@/lib/builder/types';
import { latestDecisions } from '@/lib/db/match-queries';
import { Builder } from './Builder';
import { genEdFor } from '@/lib/builder/degree-data';
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

  // Decisions that name a draft skill apply only on this map; the non-draft ones are already in the library.
  const planDecisions: Record<string, MatchDecision> = {};
  try {
    for (const [key, d] of await latestDecisions({ planId: plan.id })) {
      if (!d.draft) continue;
      planDecisions[key] = { requiredRef: d.requiredHash, suppliedRef: d.suppliedHash, label: d.label, by: d.decidedBy, at: new Date(d.decidedAt).toISOString(), draft: true };
    }
  } catch { /* 0069 not applied on this database: no decisions */ }

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
      planDecisions={planDecisions}
      genEd={genEdFor(state.catalogYear)}
    />
  );
}
