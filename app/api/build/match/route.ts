import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots, curriculumPlans } from '@/lib/db/schema';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { embedMissing, readVectors } from '@/lib/db/bundle-queries';
import { insertDecision, readJudgments, writeJudgments } from '@/lib/db/match-queries';
import { embedBatch, cosineSimilarity, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { judgePairs, MODELS, MODEL_IN_USE, PROMPT_VERSION, type PairText } from '@/lib/ai/match-judge';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 600;
const OTHERS_MAX = 400;
const TOP = 5;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const hashOf = (s: string) => textHash(normalizeStatement(s));

/** A failure of the campus model (embedding or judge call); anything else is a server fault. */
class CampusError extends Error {}
const viaCampus = async <T,>(f: () => Promise<T>): Promise<T> => {
  try { return await f(); } catch (err) { throw new CampusError(err instanceof Error ? err.message : 'unknown error'); }
};

type Side = { course: string; title: string; snapshotId: string | null; ref: string; text: string };

function readSide(v: unknown): Side | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  const snapshotId = o.snapshotId === null || o.snapshotId === undefined ? null : o.snapshotId;
  if (typeof o.course !== 'string' || !o.course.trim() || o.course.length > 40) return null;
  if (typeof o.ref !== 'string' || !o.ref) return null;
  if (snapshotId !== null && (typeof snapshotId !== 'string' || !UUID.test(snapshotId))) return null;
  if (snapshotId === null && (!text || text.length > TEXT_MAX)) return null;
  return { course: o.course.trim(), title: typeof o.title === 'string' ? o.title.trim().slice(0, 200) : '', snapshotId, ref: o.ref, text };
}

/** A captured side's text comes from the capture itself (required skills: incoming expectations; supplied: developed skills). */
async function captured(side: Side, kind: 'required' | 'supplied'): Promise<{ course: string; text: string } | null> {
  const [snap] = await db.select({ courseCode: courseCaptureSnapshots.courseCode, profile: courseCaptureSnapshots.profile })
    .from(courseCaptureSnapshots).where(eq(courseCaptureSnapshots.id, side.snapshotId!));
  if (!snap) return null;
  const p = snap.profile as { incoming_expectations?: Array<{ statement?: string }>; competencies?: Array<{ statement?: string }> } | null;
  const list = (kind === 'required' ? p?.incoming_expectations : p?.competencies) ?? [];
  const text = list.map((x) => (x.statement ?? '').trim()).find((s) => s && hashOf(s) === side.ref);
  return text ? { course: snap.courseCode, text } : null;
}

/**
 * POST /api/build/match — faculty decisions on a skill match, and on-demand judging of new draft skills.
 *   decide: { planId, required: PairSide, supplied: PairSide, label: 'fully'|'partly'|'not', reason?, authorName? }
 *           PairSide = { course, title, snapshotId: string | null, ref, text }. A captured side's text is read from the
 *           capture by ref (never the body); a side without a snapshot is a draft and takes the body text.
 *   judge:  { anchor: { text, course, title, side: 'required'|'supplied' }, others: [{ ref, text, course, title }] }
 *           -> { results: [{ ref, similarity, pFully, pPartly }] } for the top 5 others by embedding similarity,
 *              judged by both models (cached); the probabilities returned are the model in use.
 * → 200 | 400 | 404 | 502 (the campus model is unreachable)
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  let body: Record<string, unknown> = {};
  try { const p = await req.json(); if (p && typeof p === 'object') body = p; } catch { /* handled below */ }

  if (body.action === 'decide') return decide(body, personalName(auth.grant) ?? (typeof body.authorName === 'string' && body.authorName.trim() ? body.authorName.trim().slice(0, NAME_MAX) : 'Department login'));
  if (body.action === 'judge') return judge(body);
  return bad('Unknown action.');
}

async function decide(body: Record<string, unknown>, who: string): Promise<Response> {
  const { planId, label } = body;
  if (typeof planId !== 'string' || !UUID.test(planId)) return bad('A plan is required.');
  if (label !== 'fully' && label !== 'partly' && label !== 'not') return bad('Label must be fully, partly or not.');
  const req = readSide(body.required), sup = readSide(body.supplied);
  if (!req || !sup) return bad('Both skills are required, each with a course and (for a new skill) its text.');
  const [plan] = await db.select({ id: curriculumPlans.id }).from(curriculumPlans).where(eq(curriculumPlans.id, planId));
  if (!plan) return NextResponse.json({ error: 'That plan does not exist.' }, { status: 404 });

  const resolve = async (side: Side, kind: 'required' | 'supplied') => {
    if (side.snapshotId === null) return { course: side.course, text: side.text, hash: hashOf(side.text), draft: true };
    const c = await captured(side, kind);
    return c ? { ...c, hash: side.ref, draft: false } : null;
  };
  const r = await resolve(req, 'required'), s = await resolve(sup, 'supplied');
  if (!r || !s) return NextResponse.json({ error: 'That skill is not in the capture.' }, { status: 404 });

  const cached = (await readJudgments([{ requiredHash: r.hash, suppliedHash: s.hash }], MODEL_IN_USE, PROMPT_VERSION)).get(`${r.hash}|${s.hash}`);
  await insertDecision({
    requiredHash: r.hash, suppliedHash: s.hash, requiredText: r.text, suppliedText: s.text,
    requiredCourse: r.course, requiredCourseTitle: req.title || null, suppliedCourse: s.course, suppliedCourseTitle: sup.title || null,
    requiredSnapshotId: req.snapshotId, suppliedSnapshotId: sup.snapshotId,
    label, draft: r.draft || s.draft, planId, source: 'map',
    reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null,
    decidedBy: who, judgeModel: MODEL_IN_USE, promptVersion: PROMPT_VERSION,
    judgePFully: cached?.pFully ?? null, judgePPartly: cached?.pPartly ?? null,
  });
  return NextResponse.json({ ok: true });
}

async function judge(body: Record<string, unknown>): Promise<Response> {
  const a = body.anchor as Record<string, unknown> | undefined;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (!a || !text(a.text) || text(a.text).length > TEXT_MAX || (a.side !== 'required' && a.side !== 'supplied')) return bad('An anchor skill and its side are required.');
  if (!Array.isArray(body.others) || body.others.length === 0) return bad('Nothing to compare with.');
  if (body.others.length > OTHERS_MAX) return bad(`At most ${OTHERS_MAX} skills to compare.`);
  const others: Array<{ ref: string; text: string; course: string; title: string }> = [];
  for (const o of body.others as Array<Record<string, unknown>>) {
    if (!o || typeof o.ref !== 'string' || !o.ref || !text(o.text) || text(o.text).length > TEXT_MAX || typeof o.course !== 'string') return bad('Each skill needs a ref, text (up to 600 characters) and a course.');
    others.push({ ref: o.ref, text: text(o.text), course: o.course, title: typeof o.title === 'string' ? o.title : '' });
  }
  const anchorText = text(a.text), anchorRef = hashOf(anchorText);

  const sink = { message: null as string | null };
  const unreachable = (why: string) => NextResponse.json({ error: `The campus model is not reachable right now (${why}). Try again in a few minutes.` }, { status: 502 });
  try {
    const items = [...new Map([{ ref: anchorRef, text: anchorText }, ...others].map((x) => [x.ref, { kind: 'course_skill' as const, ref: x.ref, text: x.text }])).values()];
    await embedMissing(db, items, DEFAULT_EMBEDDING_MODEL, (t) => viaCampus(() => embedBatch(t)));
    const vecs = await readVectors(db, 'course_skill', items, DEFAULT_EMBEDDING_MODEL);
    const av = vecs.get(anchorRef);
    const seen = new Set<string>();
    const top = others
      .filter((o) => vecs.has(o.ref) && !seen.has(o.ref) && !!seen.add(o.ref))
      .map((o) => ({ o, sim: av ? cosineSimilarity(av, vecs.get(o.ref)!) : 0 }))
      .sort((x, y) => y.sim - x.sim)
      .slice(0, TOP);

    const asRequired = a.side === 'required';
    const pairs = top.map(({ o }) => ({
      requiredHash: asRequired ? anchorRef : o.ref, suppliedHash: asRequired ? o.ref : anchorRef,
      text: {
        requiredText: asRequired ? anchorText : o.text, requiredCourse: asRequired ? text(a.course) : o.course, requiredTitle: asRequired ? text(a.title) : o.title,
        suppliedText: asRequired ? o.text : anchorText, suppliedCourse: asRequired ? o.course : text(a.course), suppliedTitle: asRequired ? o.title : text(a.title),
      } as PairText,
    }));
    const key = (p: { requiredHash: string; suppliedHash: string }) => `${p.requiredHash}|${p.suppliedHash}`;

    let inUse = new Map<string, { pFully: number; pPartly: number }>();
    for (const model of MODELS) { // one model at a time: the gateway reloads on a model switch
      const cached = await readJudgments(pairs, model, PROMPT_VERSION);
      const missing = pairs.filter((p) => !cached.has(key(p)));
      if (missing.length) {
        const out = await viaCampus(() => judgePairs(missing.map((p) => p.text), { model, errorSink: sink }));
        const fresh = missing.map((p, i) => ({ p, o: out[i]! })).filter((x) => x.o.pFully !== null && x.o.pPartly !== null);
        await writeJudgments(fresh.map(({ p, o }) => ({ requiredHash: p.requiredHash, suppliedHash: p.suppliedHash, model, promptVersion: PROMPT_VERSION, pFully: o.pFully, pPartly: o.pPartly })));
        for (const { p, o } of fresh) cached.set(key(p), { pFully: o.pFully!, pPartly: o.pPartly! });
      }
      if (model === MODEL_IN_USE) {
        inUse = cached;
        if (pairs.some((p) => !cached.has(key(p)))) return unreachable(sink.message ?? 'no answer');
      }
    }
    return NextResponse.json({
      results: top.map(({ o, sim }, i) => ({ ref: o.ref, similarity: sim, pFully: inUse.get(key(pairs[i]!))!.pFully, pPartly: inUse.get(key(pairs[i]!))!.pPartly })),
    });
  } catch (err) {
    if (err instanceof CampusError) return unreachable(sink.message ?? err.message);
    console.error('[build/match] judge failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Something went wrong on the server. Try again, and tell the maintainer if it keeps happening.' }, { status: 500 });
  }
}
