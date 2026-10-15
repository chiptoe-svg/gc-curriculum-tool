import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { readAgreementInputs, ONET_ATTRIBUTION } from '@/lib/db/bundle-queries';
import { computeAgreement, sumAgreement, cohenKappa } from '@/lib/catalog/agreement';
import { jsonError, jsonOk } from '../_shared';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5).
// Auth: the middleware grant gate (admin kind for /api/admin/**) is primary;
// checkAdminAuth is the in-route second factor (tests/api/admin-routes-gated.test.ts).
// Blindness: readAgreementInputs reads SUBMITTED samples only, and its
// no-match list excludes bundles whose blind pick is unsubmitted.
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return jsonError('unauthorized', 401);
  const { inputs, noMatch, notYetMapped, secondReviewerPairs } = await readAgreementInputs();
  const rows = inputs.map(computeAgreement);
  return jsonOk({
    rows,
    total: sumAgreement(rows),
    kappas: secondReviewerPairs.map(p => ({ bundleId: p.bundleId, kappa: cohenKappa(p.a, p.b) })),
    noMatch,
    notYetMapped,
    attribution: ONET_ATTRIBUTION,
  });
}
