import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { getCluster } from '@/lib/db/cluster-queries';
import { planDraftDecisions } from '@/lib/db/match-queries';
import { isUndefinedTable } from '@/lib/db/pg-errors';
import { loadLibrary } from '@/lib/builder/library';
import { emptyClusterState, parseClusterState } from '@/lib/builder/cluster/state';
import { clusterStatuses } from '@/lib/builder/cluster/status';
import { renderChangesMarkdown } from '@/lib/builder/changes-md';
import type { PlacedCourse } from '@/lib/builder/compute';
import type { MatchDecision } from '@/lib/builder/types';

interface Ctx { params: Promise<{ id: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 });

/**
 * GET /api/build/clusters/[id]/changes.md: the cluster's changes as a Markdown download.
 * Statuses use the library's own matches and faculty decisions only (no live judging here), so a skill the
 * judge has not seen reads "Matching…"; the file says so.
 */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const [cluster, lib] = await Promise.all([getCluster(id), loadLibrary()]);
  if (!cluster) return notFound();
  const state = parseClusterState({ ...emptyClusterState(), ...(cluster.state as object) });
  if (!state) return NextResponse.json({ error: 'The cluster could not be read.' }, { status: 422 });

  const byCode = new Map(lib.courses.map(c => [c.code, c]));
  const proposed = new Map(state.proposed.map(p => [p.id, p]));
  const placed: PlacedCourse[] = state.cards.flatMap((card, i) => {
    const lc = byCode.get(card.ref);
    const pc = lc ? undefined : proposed.get(card.ref);
    const src = lc ?? pc;
    if (!src) return [];
    return [{
      ref: card.ref, code: src.code, title: src.title, act: 1 as const, branch: null, seq: i, term: 0, credits: null,
      proposed: !lc, reading: { depths: [], basis: null, filled: false },
    }];
  });

  // Decisions made on this cluster (stored with plan_id = the cluster id), plus the non-draft ones the library holds.
  // Lookup may use all of them; the export lists only those whose two skills are on this cluster's courses (renderChangesMarkdown scopes them).
  const clusterDecisions: Record<string, MatchDecision> = {};
  try {
    for (const [key, d] of await planDraftDecisions(id)) {
      clusterDecisions[key] = { requiredRef: d.requiredHash, suppliedRef: d.suppliedHash, label: d.label, by: d.decidedBy, at: new Date(d.decidedAt).toISOString(), draft: true };
    }
  } catch (err) { // 0069 not applied on this database: no decisions, silently; anything else is logged
    if (!isUndefinedTable(err)) console.error('[build/cluster changes.md] decisions failed:', err instanceof Error ? err.message : err);
  }
  const decisions = { ...lib.decisions, ...clusterDecisions };
  const statuses = clusterStatuses(lib, state, {}, {}, decisions);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const md = renderChangesMarkdown({
    planName: cluster.name, exportedBy: personalName(auth.grant) ?? 'Department login', date, lib, plan: state,
    placed, required: {}, clusterStatuses: statuses, decisions: Object.values(decisions),
    note: 'Match statuses are as last judged: the catalog\'s own matches and faculty decisions. A skill not yet judged reads Matching….',
  });
  const slug = cluster.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cluster';
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-changes-${date}.md"`,
      'Cache-Control': 'no-store',
    },
  });
}
