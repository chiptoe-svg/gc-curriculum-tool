import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { searchItems, ONET_ATTRIBUTION } from '@/lib/db/bundle-queries';
import { ONET_RELEASE, jsonError, jsonOk } from '../_shared';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5).
// Auth: the middleware grant gate (admin kind for /api/admin/**) is primary;
// checkAdminAuth is the in-route second factor (tests/api/admin-routes-gated.test.ts).
// Blindness: O*NET items only — no membership fields, so a search can never
// reveal where the AI placed anything.
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return jsonError('unauthorized', 401);
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2 || q.length > 100) return jsonError('q must be 2–100 characters', 400);
  const results = await searchItems(q, ONET_RELEASE);
  return jsonOk({ ...results, attribution: ONET_ATTRIBUTION });
}
