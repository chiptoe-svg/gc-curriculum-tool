import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { db } from '@/lib/db/client';
import { recomputeCareerWeightsSafely } from '@/lib/db/career-weight-queries';
import { resetBlind, validateReviewer } from '@/lib/db/bundle-queries';
import { ID_RE, jsonError, jsonOk, readBody, bodySlug } from '../../_shared';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5).
// Auth: the middleware grant gate (admin kind for /api/admin/**) is primary;
// checkAdminAuth is the in-route second factor (tests/api/admin-routes-gated.test.ts).
// POST: hasJsonContentType first (415 — blocks the simple-form CSRF vector),
// slug in the body, reviewer name a required typed field (plan Ruling 2),
// every write in one db.transaction.
// resetBlind requires a SUBMITTED sample (409 otherwise) and a 1–500 character
// note; it undoes reconcile's changes and re-locks the bundle (controller ruling C).
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!hasJsonContentType(req)) return jsonError('content-type must be application/json', 415);
  const body = await readBody(req);
  if (!checkAdminAuth(req, { slug: bodySlug(body) })) return jsonError('unauthorized', 401);
  const { id } = await params;
  if (!ID_RE.test(id)) return jsonError('bad id', 400);
  const r = validateReviewer(body.reviewer);
  if ('error' in r) return jsonError(r.error, 400);
  if (typeof body.note !== 'string' || body.note.trim().length < 1 || body.note.trim().length > 500) {
    return jsonError('a reset note of 1–500 characters is required', 400);
  }
  const note = body.note;
  const result = await db.transaction(tx => resetBlind(tx, id, r.reviewer, note));
  if (!result.ok) return jsonError(result.error, result.status);
  await recomputeCareerWeightsSafely('blind reset'); // P3: confirmed core items changed; after commit, never fails the request
  return jsonOk(result);
}
