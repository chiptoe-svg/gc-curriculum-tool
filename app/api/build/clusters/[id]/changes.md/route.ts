import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { getCluster } from '@/lib/db/cluster-queries';
import { loadLibrary } from '@/lib/builder/library';
import { emptyClusterState, parseClusterState } from '@/lib/builder/cluster/state';
import { clusterStatuses } from '@/lib/builder/cluster/status';
import { renderChangesMarkdown } from '@/lib/builder/changes-md';
import type { PlacedCourse } from '@/lib/builder/compute';

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

  const statuses = clusterStatuses(lib, state, {}, {}, lib.decisions);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const md = renderChangesMarkdown({
    planName: cluster.name, exportedBy: personalName(auth.grant) ?? 'Department login', date, lib, plan: state,
    placed, required: {}, clusterStatuses: statuses, decisions: Object.values(lib.decisions),
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
