import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { getPlan } from '@/lib/db/curriculum-plan-queries';
import { planDraftDecisions, readJudgments } from '@/lib/db/match-queries';
import { isUndefinedTable } from '@/lib/db/pg-errors';
import { loadLibrary } from '@/lib/builder/library';
import { parsePlanState } from '@/lib/builder/plan-schema';
import { placeCourses } from '@/lib/builder/compute';
import { requiredByCourse, type DraftJudgments } from '@/lib/builder/threads';
import { draftPairs, renderChangesMarkdown } from '@/lib/builder/changes-md';
import { MODEL_IN_USE, PROMPT_VERSION } from '@/lib/ai/match-judge';
import { EMPTY_PLAN, type MatchDecision } from '@/lib/builder/types';

interface Ctx { params: Promise<{ id: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 });

/** GET /api/build/plans/[id]/changes.md: the map's changes as a Markdown download. */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const [plan, lib] = await Promise.all([getPlan(id), loadLibrary()]);
  if (!plan) return notFound();
  const stored = (plan.state ?? {}) as Partial<typeof EMPTY_PLAN>;
  const state = parsePlanState({ ...EMPTY_PLAN, ...stored, goal: { ...EMPTY_PLAN.goal, ...(stored.goal ?? {}) } });
  if (!state) return NextResponse.json({ error: 'The plan could not be read.' }, { status: 422 });

  // Draft decisions for this plan, plus the non-draft ones the library holds (same split as the builder page).
  const planDecisions: Record<string, MatchDecision> = {};
  try {
    for (const [key, d] of await planDraftDecisions(plan.id)) {
      planDecisions[key] = { requiredRef: d.requiredHash, suppliedRef: d.suppliedHash, label: d.label, by: d.decidedBy, at: new Date(d.decidedAt).toISOString(), draft: true };
    }
  } catch (err) { // 0069 not applied on this database: no decisions, silently; anything else is logged
    if (!isUndefinedTable(err)) console.error('[build/changes.md] plan decisions failed:', err instanceof Error ? err.message : err);
  }

  // The judgments the builder fetched for draft skills are cached by text hash, so read them back to match the map.
  const drafts: DraftJudgments = {};
  try {
    for (const [k, v] of await readJudgments(draftPairs(lib, state), MODEL_IN_USE, PROMPT_VERSION)) drafts[k] = v;
  } catch (err) { // 0069 not applied: no cached judgments, silently; anything else is logged
    if (!isUndefinedTable(err)) console.error('[build/changes.md] draft judgments failed:', err instanceof Error ? err.message : err);
  }

  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const required = requiredByCourse(lib, state, placeCourses(lib, state), drafts, planDecisions);
  const md = renderChangesMarkdown({
    planName: plan.name, catalogYear: state.catalogYear ?? null, exportedBy: personalName(auth.grant) ?? 'Department login',
    date, lib, plan: state, required, decisions: Object.values({ ...lib.decisions, ...planDecisions }),
  });
  const slug = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'plan';
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-changes-${date}.md"`,
      'Cache-Control': 'no-store',
    },
  });
}
