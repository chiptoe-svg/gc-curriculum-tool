import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { isValidSlug } from '@/lib/slug';
import { getRequestGrant, personalName } from '@/lib/auth/viewer';
import { getCluster } from '@/lib/db/cluster-queries';
import { loadLibrary } from '@/lib/builder/library';
import { readClusterState } from '@/lib/builder/cluster/state';
import type { MatchDecision } from '@/lib/builder/types';
import { planDraftDecisions } from '@/lib/db/match-queries';
import { isUndefinedTable } from '@/lib/db/pg-errors';
import { loadObjectiveGuideSection, type ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';
import { ClusterBuilder } from './ClusterBuilder';
import '../../build.css';
import '../cluster.css';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BuildClusterPage({ params, searchParams }: {
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
  const [cluster, library, grant] = await Promise.all([getCluster(id), loadLibrary(), getRequestGrant(await headers())]);
  if (!cluster) notFound();
  // If the saved state cannot be read, say so and stop: opening it as an empty cluster would let the first edit overwrite it.
  const state = readClusterState(cluster.state);
  if (!state) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">This cluster cannot be opened</h1>
        <p className="mt-3 text-muted-foreground">“{cluster.name}” was saved in a form this version of the builder cannot read. It has not been changed. Tell the site administrator.</p>
      </div>
    );
  }

  // Decisions that name a draft skill apply only on this cluster (stored with plan_id = the cluster's id).
  const clusterDecisions: Record<string, MatchDecision> = {};
  try {
    for (const [key, d] of await planDraftDecisions(cluster.id)) {
      clusterDecisions[key] = { requiredRef: d.requiredHash, suppliedRef: d.suppliedHash, label: d.label, by: d.decidedBy, at: new Date(d.decidedAt).toISOString(), draft: true };
    }
  } catch (err) { // decisions table missing on this database: none, silently; anything else is logged
    if (!isUndefinedTable(err)) console.error('[build/clusters] decisions failed:', err instanceof Error ? err.message : err);
  }

  // The wiki's objective guide for each tracked course on the cluster, shown read-only in the course panel. Only a stored
  // guide is shown (the wiki's "no syllabus" notices are for the course page); a failed read just leaves it out.
  const guides: Record<string, ObjectiveGuideSection | null> = {};
  const tracked = state.cards.map(c => c.ref).filter(ref => library.courses.some(c => c.code === ref));
  await Promise.all(tracked.map(async code => {
    const g = await loadObjectiveGuideSection(code).catch(() => null);
    guides[code] = g?.kind === 'guide' ? g : null;
  }));

  return (
    <ClusterBuilder
      clusterId={cluster.id}
      slug={slug}
      library={library}
      initialName={cluster.name}
      initialState={state}
      initialVersion={cluster.version}
      knownName={personalName(grant)}
      clusterDecisions={clusterDecisions}
      guides={guides}
    />
  );
}
