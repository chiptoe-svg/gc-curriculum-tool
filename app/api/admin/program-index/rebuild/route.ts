import { NextResponse, after } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { rebuildProgramIndex } from '@/lib/capture/program-index';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/admin/program-index/rebuild
 *
 * Full cross-course spine rebuild + one-time backfill. Refreshes every
 * course's slice of the shared `program` Weaviate tenant. Use after a
 * Weaviate reset or to recover from a partially-failed backfill.
 *
 * Runs in the background (after()) so the request returns immediately;
 * a full rebuild across ~30 courses takes a while. Progress is in server
 * logs. Idempotent — repeated runs converge.
 *
 * Gated by /api/admin/* middleware (FACULTY_BASIC_AUTH) and checkAdminAuth
 * (Bearer ADMIN_TOKEN, or legacy slug second factor).
 */
export async function POST(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  after(async () => {
    try {
      const { courses } = await rebuildProgramIndex();
      console.log(`[program-index] full rebuild complete: ${courses} courses`);
    } catch (err) {
      console.error('[program-index] full rebuild failed', err);
    }
  });

  return NextResponse.json({ status: 'rebuilding' });
}
