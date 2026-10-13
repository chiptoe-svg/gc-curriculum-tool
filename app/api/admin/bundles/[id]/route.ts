import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { readBundleDetail, ONET_ATTRIBUTION } from '@/lib/db/bundle-queries';
import { ID_RE, jsonError, jsonOk } from '../_shared';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5).
// Auth: the middleware grant gate (admin kind for /api/admin/**) is primary;
// checkAdminAuth is the in-route second factor (tests/api/admin-routes-gated.test.ts).
// Blindness: readBundleDetail returns members = null (and latestOutcome = null)
// while the bundle's blind pick is unsubmitted, so AI placements never leave the server.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!checkAdminAuth(req)) return jsonError('unauthorized', 401);
  const { id } = await params;
  if (!ID_RE.test(id)) return jsonError('bad id', 400);
  const detail = await readBundleDetail(id);
  if (!detail) return jsonError('not found', 404);
  return jsonOk({ ...detail, attribution: ONET_ATTRIBUTION });
}
