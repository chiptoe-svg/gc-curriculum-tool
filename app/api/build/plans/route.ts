import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { createPlan, listPlans } from '@/lib/db/curriculum-plan-queries';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { defaultAct } from '@/lib/builder/compute';
import { loadPrereqMap } from '@/lib/curriculum/prereq-map';
import { EMPTY_PLAN, type PlanState } from '@/lib/builder/types';
import { ownerOf } from '@/lib/what-if/ownership';

/** Today's GC core on the trunk, each course in the act its level suggests. */
async function coreStart(): Promise<PlanState> {
  const rows = await db.select({ code: courses.code, level: courses.level }).from(courses)
    .where(and(eq(courses.scope, 'gc'), eq(courses.status, 'offered'), eq(courses.category, 'gc_core')))
    .orderBy(asc(courses.courseNumber), asc(courses.code));
  // Within an act, a course follows the core courses it lists as prerequisites, so the starting map has no order problems of its own making.
  const edges = (await loadPrereqMap()).edges;
  const placed: string[] = [];
  const pending = rows.map(c => ({ ...c, act: defaultAct(c) }));
  while (pending.length) {
    const i = pending.findIndex(c => !pending.some(p => p !== c && p.act === c.act && edges.some(e => e.focal === c.code && e.prereq === p.code)));
    const [next] = pending.splice(i < 0 ? 0 : i, 1); // a cycle: take the next in number order
    placed.push(next!.code);
  }
  const actOf = new Map(rows.map(c => [c.code, defaultAct(c)]));
  return { ...EMPTY_PLAN, placements: placed.map(code => ({ ref: code, act: actOf.get(code)!, branch: null })) };
}

/**
 * POST /api/build/plans
 * Body: { name, start: 'core' | 'blank', authorName? } (authorName is read only for a login that names nobody).
 * → 201 { id }
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  let body: { name?: unknown; start?: unknown; authorName?: unknown } = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object') body = parsed;
  } catch { /* handled below */ }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, NAME_MAX) : '';
  if (!name) return NextResponse.json({ error: 'A plan needs a name.' }, { status: 400 });
  const createdBy = personalName(auth.grant)
    ?? (typeof body.authorName === 'string' ? body.authorName.trim().slice(0, NAME_MAX) : '');
  if (!createdBy) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });

  const state = body.start === 'blank' ? EMPTY_PLAN : await coreStart();
  const plan = await createPlan({ name, state, createdBy, ...ownerOf(auth.grant) });
  return NextResponse.json({ id: plan.id }, { status: 201 });
}

/** GET /api/build/plans → every plan, newest first. Plans are shared working documents. */
export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const plans = await listPlans();
  return NextResponse.json({ plans: plans.map(p => ({ id: p.id, name: p.name, createdBy: p.createdBy, updatedBy: p.updatedBy, updatedAt: p.updatedAt, courses: p.courses })) });
}
