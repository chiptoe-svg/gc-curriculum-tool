import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { createCluster, listClusters } from '@/lib/db/cluster-queries';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { loadLibrary } from '@/lib/builder/library';
import { nextCardSpot } from '@/lib/builder/cluster/spot';
import { emptyClusterState, type ClusterCard } from '@/lib/builder/cluster/state';
import { ownerOf } from '@/lib/what-if/ownership';

const MAX_CARDS = 40;

/**
 * POST /api/build/clusters
 * Body: { name, authorName?, courses? } (courses: catalog course codes to start with, at most 40; unknown codes are ignored) (authorName is read only for a login that names nobody).
 * → 201 { id }
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  let body: { name?: unknown; authorName?: unknown; courses?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch { /* handled below */ }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, NAME_MAX) : '';
  if (!name) return NextResponse.json({ error: 'A cluster needs a name.' }, { status: 400 });
  const createdBy = personalName(auth.grant)
    ?? (typeof body.authorName === 'string' ? body.authorName.trim().slice(0, NAME_MAX) : '');
  if (!createdBy) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });

  const state = emptyClusterState();
  if (Array.isArray(body.courses)) {
    if (body.courses.length > MAX_CARDS) return NextResponse.json({ error: `A cluster can hold ${MAX_CARDS} courses.` }, { status: 400 });
    const known = new Set((await loadLibrary()).courses.map(c => c.code));
    const cards: ClusterCard[] = [];
    for (const code of body.courses) {
      if (typeof code !== 'string' || !known.has(code) || cards.some(c => c.ref === code)) continue;
      cards.push({ ref: code, ...nextCardSpot(cards) });
    }
    state.cards = cards;
  }
  const cluster = await createCluster({ name, state, createdBy, ...ownerOf(auth.grant) });
  return NextResponse.json({ id: cluster.id }, { status: 201 });
}

/** GET /api/build/clusters → every cluster, newest first. Clusters are shared working documents, like plans. */
export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const clusters = await listClusters();
  return NextResponse.json({ clusters: clusters.map(c => ({ id: c.id, name: c.name, createdBy: c.createdBy, updatedBy: c.updatedBy, updatedAt: c.updatedAt, courses: c.courses })) });
}
