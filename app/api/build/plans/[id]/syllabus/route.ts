import { authorizeRequest } from '@/lib/auth/route-auth';
import { db } from '@/lib/db/client';
import { planSyllabusDrafts } from '@/lib/db/schema';
import { getPlan } from '@/lib/db/curriculum-plan-queries';
import { handleSyllabusImport } from '@/lib/builder/syllabus-import-handler';
import type { PlanState } from '@/lib/builder/types';

interface Ctx { params: Promise<{ id: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/build/plans/[id]/syllabus (multipart): draft a course on this plan from its syllabus. The work is shared with clusters: see handleSyllabusImport. */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: 'not found' }, { status: 404 });
  return handleSyllabusImport(req, {
    id, grant: auth.grant,
    load: async planId => { const plan = await getPlan(planId); return plan ? { state: (plan.state ?? {}) as PlanState } : null; },
    saveDraft: async row => {
      const [saved] = await db.insert(planSyllabusDrafts).values({ planId: id, ...row })
        .returning({ id: planSyllabusDrafts.id, at: planSyllabusDrafts.draftedAt });
      return saved!;
    },
  });
}
