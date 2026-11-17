import { NextResponse } from 'next/server';
import { authorizeRequest, forbidden } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { deleteCluster, getCluster, saveCluster } from '@/lib/db/cluster-queries';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { parseClusterState } from '@/lib/builder/cluster/state';
import { canManageWhatIf } from '@/lib/what-if/ownership';

interface Ctx { params: Promise<{ id: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 });

/**
 * PUT /api/build/clusters/[id]
 * Body: { name, state, version, authorName? }. Anyone who can build plans may save any cluster.
 * → 200 { version } | 409 { error, version, updatedBy } when someone else saved first.
 */
export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  let body: { name?: unknown; state?: unknown; version?: unknown; authorName?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch { /* handled below */ }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, NAME_MAX) : '';
  const state = parseClusterState(body.state);
  if (!name || !state || typeof body.version !== 'number' || !Number.isInteger(body.version)) {
    return NextResponse.json({ error: 'The cluster could not be read.' }, { status: 400 });
  }
  const updatedBy = personalName(auth.grant)
    ?? (typeof body.authorName === 'string' ? body.authorName.trim().slice(0, NAME_MAX) : '');

  const saved = await saveCluster(id, body.version, { name, state, updatedBy: updatedBy || 'Department login' });
  if (saved) return NextResponse.json({ version: saved.version });
  const current = await getCluster(id);
  if (!current) return notFound();
  return NextResponse.json(
    { error: 'Someone else saved this cluster after you opened it.', version: current.version, updatedBy: current.updatedBy },
    { status: 409 },
  );
}

/** DELETE /api/build/clusters/[id]: the person who created it, or an admin. */
export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const cluster = await getCluster(id);
  if (!cluster) return notFound();
  if (!canManageWhatIf(auth.grant, cluster)) return forbidden();
  await deleteCluster(id);
  return NextResponse.json({ ok: true });
}
