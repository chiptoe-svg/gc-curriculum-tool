import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { db } from '@/lib/db/client';
import { recomputeCareerWeightsSafely } from '@/lib/db/career-weight-queries';
import { submitBlindPicks, validateReviewer, type BlindPickInput } from '@/lib/db/bundle-queries';
import type { Pos } from '@/lib/catalog/agreement';
import { ID_RE, ONET_RELEASE, jsonError, jsonOk, readBody, bodySlug } from '../../_shared';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5).
// Auth: the middleware grant gate (admin kind for /api/admin/**) is primary;
// checkAdminAuth is the in-route second factor (tests/api/admin-routes-gated.test.ts).
// POST: hasJsonContentType first (415 — blocks the simple-form CSRF vector),
// slug in the body, reviewer name a required typed field (plan Ruling 2),
// every write in one db.transaction.
// Blind submit: picks, submitted_at and reconcile commit in ONE transaction
// (plan Ruling 8); only after it commits do the detail/list routes reveal
// the AI's placements.
export const dynamic = 'force-dynamic';
const ELEMENT_ID_RE = /^[0-9A-Za-z.-]{1,40}$/;
// The blind check offers core / related / unmarked only (decision 2026-10-19); fringe is a queue-only position.
const BLIND_POSITIONS = new Set(['core', 'related']);
const GROUP_KEY_RE = /^[0-9a-f]{16}$/;

function parsePicks(v: unknown): BlindPickInput[] | null {
  if (!Array.isArray(v) || v.length > 500) return null;
  const out: BlindPickInput[] = [];
  for (const raw of v) {
    if (raw === null || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    if (!BLIND_POSITIONS.has(String(p.position))) return null;
    const position = p.position as Pos;
    if (p.kind === 'element' && typeof p.elementId === 'string' && ELEMENT_ID_RE.test(p.elementId)) out.push({ kind: 'element', elementId: p.elementId, position });
    else if (p.kind === 'task' && typeof p.groupKey === 'string' && GROUP_KEY_RE.test(p.groupKey)) out.push({ kind: 'task', groupKey: p.groupKey, position });
    else return null;
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!hasJsonContentType(req)) return jsonError('content-type must be application/json', 415);
  const body = await readBody(req);
  if (!checkAdminAuth(req, { slug: bodySlug(body) })) return jsonError('unauthorized', 401);
  const { id } = await params;
  if (!ID_RE.test(id)) return jsonError('bad id', 400);
  const r = validateReviewer(body.reviewer);
  if ('error' in r) return jsonError(r.error, 400);
  const picks = parsePicks(body.picks);
  if (!picks || typeof body.noCleanMatch !== 'boolean') return jsonError('bad picks', 400);
  const noCleanMatch = body.noCleanMatch;
  const result = await db.transaction(tx => submitBlindPicks(tx, id, r.reviewer, picks, noCleanMatch, ONET_RELEASE));
  if (!result.ok) return jsonError(result.error, result.status);
  await recomputeCareerWeightsSafely('blind submit'); // P3: confirmed core items changed; after commit, never fails the request
  return jsonOk(result);
}
