import { authorizeRequest } from '@/lib/auth/route-auth';
import { db } from '@/lib/db/client';
import { planSyllabusDrafts } from '@/lib/db/schema';
import { getCluster } from '@/lib/db/cluster-queries';
import { handleSyllabusImport } from '@/lib/builder/syllabus-import-handler';
import type { ClusterState } from '@/lib/builder/cluster/state';

interface Ctx { params: Promise<{ id: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/build/clusters/[id]/syllabus (multipart): draft a course on this cluster from its syllabus; same work as a plan's (handleSyllabusImport), the draft row carries `cluster_id`. */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: 'not found' }, { status: 404 });
  return handleSyllabusImport(req, {
    id, grant: auth.grant,
    load: async clusterId => { const c = await getCluster(clusterId); return c ? { state: c.state as ClusterState } : null; },
    saveDraft: async row => {
      const [saved] = await db.insert(planSyllabusDrafts).values({ clusterId: id, ...row })
        .returning({ id: planSyllabusDrafts.id, at: planSyllabusDrafts.draftedAt });
      return saved!;
    },
  });
}
