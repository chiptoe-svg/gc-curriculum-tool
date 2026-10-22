import { asc, sql } from 'drizzle-orm';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { hasJsonContentType } from '@/lib/http/require-json';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { readTargetCompetencyList, lockMembership, rebuildMembership, setPin, setHide, clearFacultyRow } from '@/lib/db/membership-queries';
import { ID_RE, jsonError, jsonOk, readBody, bodySlug } from '../bundles/_shared';

// P3 membership addendum (spec 2026-10-21-p3-membership-from-weights-design.md §5):
// faculty pin or hide a competency for a career target, or reset it to
// importance only. Same auth pattern as /api/admin/bundles: middleware grant
// gate, then checkAdminAuth with the slug; JSON content type first (415).
export const dynamic = 'force-dynamic';
const ACTIONS = new Set(['pin', 'hide', 'clear']);

export async function GET(req: Request): Promise<Response> {
  if (!checkAdminAuth(req)) return jsonError('unauthorized', 401);
  const targets = await db.select({ id: careerTargets.id, name: careerTargets.name }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  const rows = await readTargetCompetencyList(db, { includeHidden: true });
  return jsonOk({ targets, rows });
}

export async function POST(req: Request): Promise<Response> {
  if (!hasJsonContentType(req)) return jsonError('content-type must be application/json', 415);
  const body = await readBody(req);
  if (!checkAdminAuth(req, { slug: bodySlug(body) })) return jsonError('unauthorized', 401);
  const { targetId, competencyId, action } = body;
  if (typeof targetId !== 'string' || !ID_RE.test(targetId) || typeof competencyId !== 'string' || !ID_RE.test(competencyId)) return jsonError('bad id', 400);
  if (typeof action !== 'string' || !ACTIONS.has(action)) return jsonError('bad action', 400);
  try {
    const changes = await db.transaction(async (tx) => {
      await lockMembership(tx);
      if (action === 'pin') {
        const next = ((await tx.execute(sql`SELECT coalesce(max(display_order) + 1, 0)::int AS next FROM career_target_requirements
          WHERE career_target_id = ${targetId} AND weight_source = 'faculty' AND status <> 'hidden'`)).rows[0] as { next: number }).next;
        await setPin(tx, targetId, competencyId, next);
      } else if (action === 'hide') {
        await setHide(tx, targetId, competencyId);
      } else {
        await clearFacultyRow(tx, targetId, competencyId);
      }
      return rebuildMembership(tx);
    });
    return jsonOk({ ok: true, changes });
  } catch (err) {
    if ((err as { code?: string }).code === '23503') return jsonError('unknown target or competency', 404);
    throw err;
  }
}
