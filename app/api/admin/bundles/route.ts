import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { listBundlesForReview, ONET_ATTRIBUTION } from '@/lib/db/bundle-queries';
import { jsonError, jsonOk } from './_shared';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5).
// Auth: the middleware grant gate (admin kind for /api/admin/**) is primary;
// checkAdminAuth is the in-route second factor (tests/api/admin-routes-gated.test.ts).
// Blindness: listBundlesForReview nulls counts and noCleanMatch while a
// bundle's blind pick is unsubmitted, and such a bundle never counts as reviewed.
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return jsonError('unauthorized', 401);
  const bundles = await listBundlesForReview();
  // Reviewed: no proposed rows left and at least one ok mapping outcome
  // (noCleanMatch is non-null exactly when an ok outcome exists and the bundle is not locked).
  const reviewed = bundles.filter(b => b.counts !== null && b.counts.proposed === 0 && b.noCleanMatch !== null).length;
  return jsonOk({ bundles, progress: { reviewed, total: bundles.length }, attribution: ONET_ATTRIBUTION });
}
