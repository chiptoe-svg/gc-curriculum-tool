import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { db } from '@/lib/db/client';
import { applyMemberAction, validateReviewer, type MemberAction } from '@/lib/db/bundle-queries';
import type { Pos } from '@/lib/catalog/agreement';
import { ID_RE, UUID_RE, ONET_RELEASE, POSITIONS, jsonError, jsonOk, readBody, bodySlug } from '../../_shared';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5).
// Auth: the middleware grant gate (admin kind for /api/admin/**) is primary;
// checkAdminAuth is the in-route second factor (tests/api/admin-routes-gated.test.ts).
// POST: hasJsonContentType first (415 — blocks the simple-form CSRF vector),
// slug in the body, reviewer name a required typed field (plan Ruling 2),
// every write in one db.transaction.
// Blindness: applyMemberAction refuses (409) while the blind pick is unsubmitted.
export const dynamic = 'force-dynamic';
const ITEM_ID_RE = /^[0-9A-Za-z.-]{1,40}$/;
const SOC_RE = /^\d{2}-\d{4}\.\d{2}$/;

function parseAction(b: Record<string, unknown>): MemberAction | null {
  const ids = Array.isArray(b.memberIds) && b.memberIds.length > 0 && b.memberIds.length <= 500
    && b.memberIds.every(x => typeof x === 'string' && UUID_RE.test(x)) ? (b.memberIds as string[]) : null;
  const pos = POSITIONS.has(String(b.position)) ? (b.position as Pos) : null;
  switch (b.action) {
    case 'confirm': case 'reject': return ids ? { action: b.action, memberIds: ids } : null;
    case 'set_position': return ids && pos ? { action: 'set_position', memberIds: ids, position: pos } : null;
    case 'add': {
      const it = b.item as Record<string, unknown> | undefined;
      if (!it || typeof it !== 'object' || !pos) return null;
      if (it.kind === 'element' && typeof it.elementId === 'string' && ITEM_ID_RE.test(it.elementId)) {
        return { action: 'add', item: { kind: 'element', elementId: it.elementId }, position: pos };
      }
      if (it.kind === 'task' && typeof it.taskId === 'string' && ITEM_ID_RE.test(it.taskId) && typeof it.onetSocCode === 'string' && SOC_RE.test(it.onetSocCode)) {
        return { action: 'add', item: { kind: 'task', taskId: it.taskId, onetSocCode: it.onetSocCode }, position: pos };
      }
      return null;
    }
    default: return null;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!hasJsonContentType(req)) return jsonError('content-type must be application/json', 415);
  const body = await readBody(req);
  if (!checkAdminAuth(req, { slug: bodySlug(body) })) return jsonError('unauthorized', 401);
  const { id } = await params;
  if (!ID_RE.test(id)) return jsonError('bad id', 400);
  const r = validateReviewer(body.reviewer);
  if ('error' in r) return jsonError(r.error, 400);
  const action = parseAction(body);
  if (!action) return jsonError('bad action', 400);
  const result = await db.transaction(tx => applyMemberAction(tx, id, r.reviewer, action, ONET_RELEASE));
  if (!result.ok) return jsonError(result.error, result.status);
  return jsonOk(result);
}
