import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { authorizeRequest } from '@/lib/auth/route-auth';
import { personalName } from '@/lib/auth/viewer';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots, courseCatalogEntries, courses, curriculumPlans } from '@/lib/db/schema';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { NAME_MAX } from '@/lib/builder/plan-schema';
import { embedMissing, readVectors } from '@/lib/db/bundle-queries';
import { insertDecision, readJudgments, writeJudgments } from '@/lib/db/match-queries';
import { embedBatch, cosineSimilarity, DEFAULT_EMBEDDING_MODEL } from '@/lib/ai/embeddings';
import { judgePairs, MODEL_IN_USE, PROMPT_VERSION, type PairText } from '@/lib/ai/match-judge';
import { judgeSet, SET_PROMPT_VERSION } from '@/lib/ai/set-judge';
import { getCluster } from '@/lib/db/cluster-queries';
import { readSetJudgment, writeSetJudgment } from '@/lib/db/set-judgment-queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 600;
const OTHERS_MAX = 400;
const TOP = 5;
const COURSE_MAX = 40, TITLE_MAX = 200, REF_MAX = 64;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const hashOf = (s: string) => textHash(normalizeStatement(s));

/** A failure of the campus model (embedding or judge call); anything else is a server fault. */
class CampusError extends Error {}
const viaCampus = async <T,>(f: () => Promise<T>): Promise<T> => {
  try { return await f(); } catch (err) { throw new CampusError(err instanceof Error ? err.message : 'unknown error'); }
};

type ProposedLike = { id?: unknown; code?: unknown; title?: unknown; description?: unknown };
const proposedOf = (state: unknown) => ((state as { proposed?: ProposedLike[] } | null)?.proposed ?? []);

type Side = { course: string; title: string; snapshotId: string | null; ref: string; text: string };

function readSide(v: unknown): Side | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  const snapshotId = o.snapshotId === null || o.snapshotId === undefined ? null : o.snapshotId;
  if (typeof o.course !== 'string' || !o.course.trim() || o.course.length > COURSE_MAX) return null;
  if (typeof o.ref !== 'string' || !o.ref || o.ref.length > REF_MAX) return null;
  if (snapshotId !== null && (typeof snapshotId !== 'string' || !UUID.test(snapshotId))) return null;
  if (snapshotId === null && (!text || text.length > TEXT_MAX)) return null;
  return { course: o.course.trim(), title: typeof o.title === 'string' ? o.title.trim().slice(0, TITLE_MAX) : '', snapshotId, ref: o.ref, text };
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
 *   (decide and judge take `clusterId` in place of `planId`; the cluster's state supplies proposed courses and titles, and
 *   a decision from a cluster is stored with plan_id = clusterId, source 'cluster'. Giving both is a 400.)
 *   judge-set: { clusterId, target: { key, text, course, title }, pool: [{ ref, text, course, title }] }
 *           -> { verdict: { pAny, kept: ref[], pTogether, pCombining } } for the top 8 pool skills by embedding (when more
 *              are sent); cached per target text and exact pool. A failed model call is a 502 and is never stored.
 *   judge:  { anchor: { text, course, title, side: 'required'|'supplied' }, others: [{ ref, text, course, title }], planId? }
 *           -> { results: [{ ref, similarity, pFully, pPartly }] } for the top 5 others by embedding similarity,
 *              judged by the model in use (cached; the batch script fills the second model). Course titles in the
 *              prompt come from the courses table, else from the plan's proposed course, else the body (capped).
 * → 200 | 400 | 404 | 502 (the campus model is unreachable)
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authorizeRequest(req);
  if (auth.response) return auth.response;
  let body: Record<string, unknown> = {};
  try { const p = await req.json(); if (p && typeof p === 'object') body = p; } catch { /* handled below */ }

  if (body.action === 'decide') return decide(body, personalName(auth.grant) ?? (typeof body.authorName === 'string' && body.authorName.trim() ? body.authorName.trim().slice(0, NAME_MAX) : 'Department login'));
  if (body.action === 'judge') return judge(body);
  if (body.action === 'judge-set') return judgeSetAction(body);
  return bad('Unknown action.');
}

async function decide(body: Record<string, unknown>, who: string): Promise<Response> {
  const { planId, clusterId, label } = body;
  if (planId !== undefined && clusterId !== undefined) return bad('Give a plan or a cluster, not both.');
  const ownerId = clusterId !== undefined ? clusterId : planId;
  if (typeof ownerId !== 'string' || !UUID.test(ownerId)) return bad(clusterId !== undefined ? 'A cluster is required.' : 'A plan is required.');
  if (label !== 'fully' && label !== 'partly' && label !== 'not') return bad('Label must be fully, partly or not.');
  const req = readSide(body.required), sup = readSide(body.supplied);
  if (!req || !sup) return bad('Both skills are required, each with a course and (for a new skill) its text.');
  let ownerState: unknown;
  if (clusterId !== undefined) {
    const cluster = await getCluster(ownerId);
    if (!cluster) return NextResponse.json({ error: 'That cluster does not exist.' }, { status: 404 });
    ownerState = cluster.state;
  } else {
    const [plan] = await db.select({ id: curriculumPlans.id, state: curriculumPlans.state }).from(curriculumPlans).where(eq(curriculumPlans.id, ownerId));
    if (!plan) return NextResponse.json({ error: 'That plan does not exist.' }, { status: 404 });
    ownerState = plan.state;
  }

  const resolve = async (side: Side, kind: 'required' | 'supplied') => {
    if (side.snapshotId === null) return { course: side.course, text: side.text, hash: hashOf(side.text), draft: true };
    const c = await captured(side, kind);
    return c ? { ...c, hash: side.ref, draft: false } : null;
  };
  const r = await resolve(req, 'required'), s = await resolve(sup, 'supplied');
  if (!r || !s) return NextResponse.json({ error: 'That skill is not in the capture.' }, { status: 404 });

  // Titles come from the courses table, never the body. A draft side's course must be a real course or one this plan proposes.
  const known = new Map((await db.select({ code: courses.code, title: courses.title }).from(courses).where(inArray(courses.code, [r.course, s.course]))).map((c) => [c.code, c.title]));
  const proposed = new Set(proposedOf(ownerState).map((c) => c.id));
  for (const side of [r, s]) {
    if (side.draft && !known.has(side.course) && !side.course.startsWith('new:') && !proposed.has(side.course)) return bad('That course is not in the catalog or on this plan.');
  }

  const cached = (await readJudgments([{ requiredHash: r.hash, suppliedHash: s.hash }], MODEL_IN_USE, PROMPT_VERSION)).get(`${r.hash}|${s.hash}`);
  await insertDecision({
    requiredHash: r.hash, suppliedHash: s.hash, requiredText: r.text, suppliedText: s.text,
    requiredCourse: r.course, requiredCourseTitle: known.get(r.course) ?? null, suppliedCourse: s.course, suppliedCourseTitle: known.get(s.course) ?? null,
    requiredSnapshotId: req.snapshotId, suppliedSnapshotId: sup.snapshotId,
    label, draft: r.draft || s.draft, planId: ownerId, source: clusterId !== undefined ? 'cluster' : 'map',
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
  const capped = (o: Record<string, unknown>) => typeof o.course === 'string' && o.course.length <= COURSE_MAX && (o.title === undefined || (typeof o.title === 'string' && o.title.length <= TITLE_MAX));
  if (!capped(a)) return bad('A course code is at most 40 characters and a title at most 200.');
  if (!Array.isArray(body.others) || body.others.length === 0) return bad('Nothing to compare with.');
  if (body.others.length > OTHERS_MAX) return bad(`At most ${OTHERS_MAX} skills to compare.`);
  const others: Array<{ ref: string; key: string; text: string; course: string; title: string }> = [];
  for (const o of body.others as Array<Record<string, unknown>>) {
    if (!o || typeof o.ref !== 'string' || !o.ref || !text(o.text) || text(o.text).length > TEXT_MAX || typeof o.course !== 'string' || o.ref.length > REF_MAX || !capped(o)) return bad('Each skill needs a ref, text (up to 600 characters) and a course.');
    others.push({ ref: o.ref, key: hashOf(text(o.text)), text: text(o.text), course: o.course, title: typeof o.title === 'string' ? o.title : '' });
  }
  const anchorText = text(a.text), anchorRef = hashOf(anchorText);
  if (body.planId !== undefined && body.clusterId !== undefined) return bad('Give a plan or a cluster, not both.');
  if (body.planId !== undefined && (typeof body.planId !== 'string' || !UUID.test(body.planId))) return bad('That plan id is not valid.');
  if (body.clusterId !== undefined && (typeof body.clusterId !== 'string' || !UUID.test(body.clusterId))) return bad('That cluster id is not valid.');

  const sink = { message: null as string | null };
  // The upstream detail is logged here only; the browser gets a fixed message.
  const unreachable = (why: string) => {
    console.warn('[build/match] campus model failed:', why);
    return NextResponse.json({ error: 'The campus model did not answer; try again.' }, { status: 502 });
  };
  try {
    // Titles for the prompt: a tracked course's from the courses table, a proposed course's from this plan, else the body's.
    const codes = [...new Set([text(a.course), ...others.map((o) => o.course)])].filter(Boolean);
    const known = new Map(codes.length ? (await db.select({ code: courses.code, title: courses.title }).from(courses).where(inArray(courses.code, codes))).map((c) => [c.code, c.title]) : []);
    const proposed = new Map<string, string>();
    let ownerState: unknown = null;
    if (typeof body.planId === 'string') {
      const [plan] = await db.select({ state: curriculumPlans.state }).from(curriculumPlans).where(eq(curriculumPlans.id, body.planId));
      ownerState = plan?.state;
    } else if (typeof body.clusterId === 'string') {
      ownerState = (await getCluster(body.clusterId))?.state;
    }
    for (const p of proposedOf(ownerState)) {
      if (typeof p.title !== 'string') continue;
      if (typeof p.id === 'string') proposed.set(p.id, p.title);
      if (typeof p.code === 'string' && !proposed.has(p.code)) proposed.set(p.code, p.title);
    }
    const titleOf = (course: string, given: string) => (known.get(course) ?? proposed.get(course) ?? given).slice(0, TITLE_MAX);

    const items = [...new Map([{ key: anchorRef, text: anchorText }, ...others].map((x) => [x.key, { kind: 'course_skill' as const, ref: x.key, text: x.text }])).values()];
    await embedMissing(db, items, DEFAULT_EMBEDDING_MODEL, (t) => viaCampus(() => embedBatch(t)));
    const vecs = await readVectors(db, 'course_skill', items, DEFAULT_EMBEDDING_MODEL);
    const av = vecs.get(anchorRef);
    const seen = new Set<string>();
    const top = others
      .filter((o) => vecs.has(o.key) && !seen.has(o.key) && !!seen.add(o.key))
      .map((o) => ({ o, sim: av ? cosineSimilarity(av, vecs.get(o.key)!) : 0 }))
      .sort((x, y) => y.sim - x.sim)
      .slice(0, TOP);

    const asRequired = a.side === 'required';
    const pairs = top.map(({ o }) => ({
      // Keyed by the hash of the text, never the client's ref, so the cache cannot be poisoned.
      requiredHash: asRequired ? anchorRef : o.key, suppliedHash: asRequired ? o.key : anchorRef,
      text: {
        requiredText: asRequired ? anchorText : o.text, requiredCourse: asRequired ? text(a.course) : o.course,
        requiredTitle: asRequired ? titleOf(text(a.course), text(a.title)) : titleOf(o.course, o.title),
        suppliedText: asRequired ? o.text : anchorText, suppliedCourse: asRequired ? o.course : text(a.course),
        suppliedTitle: asRequired ? titleOf(o.course, o.title) : titleOf(text(a.course), text(a.title)),
      } as PairText,
    }));
    const key = (p: { requiredHash: string; suppliedHash: string }) => `${p.requiredHash}|${p.suppliedHash}`;

    // Only the model in use: asking a second model here would switch models on the gateway, which reloads on a switch.
    const model = MODEL_IN_USE;
    const inUse = await readJudgments(pairs, model, PROMPT_VERSION);
    const missing = pairs.filter((p) => !inUse.has(key(p)));
    if (missing.length) {
      const out = await viaCampus(() => judgePairs(missing.map((p) => p.text), { model, errorSink: sink }));
      const fresh = missing.map((p, i) => ({ p, o: out[i]! })).filter((x) => x.o.pFully !== null && x.o.pPartly !== null);
      await writeJudgments(fresh.map(({ p, o }) => ({ requiredHash: p.requiredHash, suppliedHash: p.suppliedHash, model, promptVersion: PROMPT_VERSION, pFully: o.pFully, pPartly: o.pPartly })));
      for (const { p, o } of fresh) inUse.set(key(p), { pFully: o.pFully!, pPartly: o.pPartly! });
    }
    if (pairs.some((p) => !inUse.has(key(p)))) return unreachable(sink.message ?? 'no answer');
    return NextResponse.json({
      results: top.map(({ o, sim }, i) => ({ ref: o.ref, similarity: sim, pFully: inUse.get(key(pairs[i]!))!.pFully, pPartly: inUse.get(key(pairs[i]!))!.pPartly })),
    });
  } catch (err) {
    if (err instanceof CampusError) return unreachable(sink.message ?? err.message);
    console.error('[build/match] judge failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Something went wrong on the server. Try again, and tell the maintainer if it keeps happening.' }, { status: 500 });
  }
}

const POOL_MAX = 8;
const DESC_CHARS = 350;

async function judgeSetAction(body: Record<string, unknown>): Promise<Response> {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const t = body.target as Record<string, unknown> | undefined;
  if (typeof body.clusterId !== 'string' || !UUID.test(body.clusterId)) return bad('A cluster is required.');
  const capped = (o: Record<string, unknown>) => typeof o.course === 'string' && !!o.course.trim() && o.course.length <= COURSE_MAX && (o.title === undefined || (typeof o.title === 'string' && o.title.length <= TITLE_MAX));
  if (!t || !text(t.text) || text(t.text).length > TEXT_MAX || !capped(t)) return bad('A target skill with its text (up to 600 characters) and course is required.');
  if (!Array.isArray(body.pool) || body.pool.length === 0) return bad('Nothing to compare with.');
  if (body.pool.length > OTHERS_MAX) return bad(`At most ${OTHERS_MAX} skills to compare.`);
  const pool: Array<{ ref: string; key: string; text: string; course: string; title: string }> = [];
  for (const o of body.pool as Array<Record<string, unknown>>) {
    if (!o || typeof o.ref !== 'string' || !o.ref || o.ref.length > REF_MAX || !text(o.text) || text(o.text).length > TEXT_MAX || !capped(o)) return bad('Each skill needs a ref, text (up to 600 characters) and a course.');
    pool.push({ ref: o.ref, key: hashOf(text(o.text)), text: text(o.text), course: (o.course as string).trim(), title: typeof o.title === 'string' ? o.title : '' });
  }
  const cluster = await getCluster(body.clusterId);
  if (!cluster) return NextResponse.json({ error: 'That cluster does not exist.' }, { status: 404 });

  const unreachable = (why: string) => {
    console.warn('[build/match] campus model failed:', why);
    return NextResponse.json({ error: 'The campus model did not answer; try again.' }, { status: 502 });
  };
  try {
    const targetText = text(t.text), targetHash = hashOf(targetText);
    // Keyed by the hash of the text, never the client's ref, so the cache cannot be poisoned.
    let cands = [...new Map(pool.map((o) => [o.key, o])).values()];
    if (cands.length > POOL_MAX) {
      const items = [{ kind: 'course_skill' as const, ref: targetHash, text: targetText }, ...cands.map((o) => ({ kind: 'course_skill' as const, ref: o.key, text: o.text }))];
      await embedMissing(db, items, DEFAULT_EMBEDDING_MODEL, (x) => viaCampus(() => embedBatch(x)));
      const vecs = await readVectors(db, 'course_skill', items, DEFAULT_EMBEDDING_MODEL);
      const tv = vecs.get(targetHash);
      cands = cands.filter((o) => vecs.has(o.key))
        .map((o) => ({ o, sim: tv ? cosineSimilarity(tv, vecs.get(o.key)!) : 0 }))
        .sort((x, y) => y.sim - x.sim).slice(0, POOL_MAX).map((x) => x.o);
    }
    if (cands.length === 0) return bad('Nothing to compare with.');
    const poolHash = textHash([...cands.map((o) => o.key)].sort().join(','));
    const refOf = new Map(cands.map((o) => [o.key, o.ref]));
    const keyOf = { targetHash, poolHash, model: MODEL_IN_USE, promptVersion: SET_PROMPT_VERSION };
    const reply = (v: { pAny: number | null; kept: string[]; pTogether: number | null; pCombining: number | null }) =>
      NextResponse.json({ verdict: { pAny: v.pAny, kept: v.kept.map((k) => refOf.get(k)).filter((r): r is string => !!r), pTogether: v.pTogether, pCombining: v.pCombining } });

    const cached = await readSetJudgment(keyOf);
    if (cached) return reply(cached);

    // Prompt context: code + title + the first 350 characters of the catalog (or proposed) description.
    const codes = [...new Set([text(t.course), ...cands.map((o) => o.course)])];
    const known = new Map((await db.select({ code: courses.code, title: courses.title }).from(courses).where(inArray(courses.code, codes))).map((c) => [c.code, c.title]));
    // The latest catalog year with a non-empty description wins: sort oldest first, skip empty, let later years overwrite.
    const catalog = new Map<string, string>();
    const entries = await db.select({ code: courseCatalogEntries.courseCode, description: courseCatalogEntries.description, year: courseCatalogEntries.catalogYear })
      .from(courseCatalogEntries).where(inArray(courseCatalogEntries.courseCode, codes));
    for (const e of [...entries].sort((a, b) => (a.year ?? '').localeCompare(b.year ?? ''))) if (e.description?.trim()) catalog.set(e.code, e.description);
    const proposed = new Map<string, { title: string; description: string }>();
    for (const p of proposedOf(cluster.state)) {
      if (typeof p.title !== 'string') continue;
      const v = { title: p.title, description: typeof p.description === 'string' ? p.description : '' };
      if (typeof p.id === 'string') proposed.set(p.id, v);
      if (typeof p.code === 'string' && !proposed.has(p.code)) proposed.set(p.code, v);
    }
    const titleFor = (course: string, given: string) => (known.get(course) ?? proposed.get(course)?.title ?? given).slice(0, TITLE_MAX);
    const contextOf = (course: string, given: string) => {
      const desc = (catalog.get(course) || proposed.get(course)?.description || '').slice(0, DESC_CHARS);
      return `${course} ${titleFor(course, given)}${desc ? ` (catalog: ${desc})` : ''}`;
    };

    // The judge sees text hashes as refs so what is stored never depends on the client's refs.
    const v = await viaCampus(() => judgeSet(
      { text: targetText, course: text(t.course), title: titleFor(text(t.course), text(t.title)), context: contextOf(text(t.course), text(t.title)) },
      cands.map((o) => ({ ref: o.key, course: o.course, title: titleFor(o.course, o.title), text: o.text, context: contextOf(o.course, o.title) })),
    ));
    await writeSetJudgment(keyOf, { pAny: v.pAny, picked: v.picked, kept: v.kept, pTogether: v.pTogether, pCombining: v.pCombining });
    return reply(v);
  } catch (err) {
    if (err instanceof CampusError) return unreachable(err.message);
    console.error('[build/match] judge-set failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Something went wrong on the server. Try again, and tell the maintainer if it keeps happening.' }, { status: 500 });
  }
}
