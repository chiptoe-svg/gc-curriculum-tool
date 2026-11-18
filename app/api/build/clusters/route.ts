import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { createCluster, listClusters } from '@/lib/db/cluster-queries';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { emptyClusterState } from '@/lib/builder/cluster/state';
import { ownerOf } from '@/lib/what-if/ownership';

/**
 * POST /api/build/clusters
 * Body: { name, authorName? } (authorName is read only for a login that names nobody).
 * → 201 { id }
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  let body: { name?: unknown; authorName?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch { /* handled below */ }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, NAME_MAX) : '';
  if (!name) return NextResponse.json({ error: 'A cluster needs a name.' }, { status: 400 });
  const createdBy = personalName(auth.grant)
    ?? (typeof body.authorName === 'string' ? body.authorName.trim().slice(0, NAME_MAX) : '');
  if (!createdBy) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });

  const cluster = await createCluster({ name, state: emptyClusterState(), createdBy, ...ownerOf(auth.grant) });
  return NextResponse.json({ id: cluster.id }, { status: 201 });
}

/** GET /api/build/clusters → every cluster, newest first. Clusters are shared working documents, like plans. */
export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const clusters = await listClusters();
  return NextResponse.json({ clusters: clusters.map(c => ({ id: c.id, name: c.name, createdBy: c.createdBy, updatedBy: c.updatedBy, updatedAt: c.updatedAt, courses: c.courses })) });
}
