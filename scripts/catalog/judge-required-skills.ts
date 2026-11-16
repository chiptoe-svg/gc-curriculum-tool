/**
 * Judge required skills against the developed skills of other courses (spec 2026-11-16-map-course-edits-and-required-skills).
 *
 *   pnpm tsx scripts/catalog/judge-required-skills.ts --expect-db <database name> [--apply] [--limit N]
 *
 * For every live capture (newest non-retired snapshot per course + instructor), each incoming expectation is a
 * required skill. Its top 8 developed skills (profile.competencies) from OTHER courses by embedding cosine are
 * judged by both models in MODELS; pairs already cached for a model (same prompt version) are skipped.
 * Dry run (default) embeds and judges nothing and writes nothing; it reports counts. --apply embeds missing
 * statements and judges the missing pairs (free campus models), writing skill_match_judgments.
 */
import { sql } from 'drizzle-orm';
import { loadAppEnv, isMainModule, argValue } from './catalog-source';

loadAppEnv();

const TOP = 8;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

type Skill = { course: string; text: string; ref: string };
type Profile = { incoming_expectations?: Array<{ statement?: string }>; competencies?: Array<{ statement?: string }> } | null;

async function main(): Promise<number> {
  const { db } = await import('@/lib/db/client');
  const { embedMissing, readVectors } = await import('@/lib/db/bundle-queries');
  const { textHash } = await import('@/lib/catalog/bundles');
  const { normalizeStatement } = await import('@/lib/catalog/project-trail');
  const { embedBatch, DEFAULT_EMBEDDING_MODEL } = await import('@/lib/ai/embeddings');
  const { readJudgments, writeJudgments } = await import('@/lib/db/match-queries');
  const { MODELS, PROMPT_VERSION, judgePairs } = await import('@/lib/ai/match-judge');

  const expect = argValue('--expect-db');
  const apply = process.argv.includes('--apply');
  const limitArg = argValue('--limit');
  const limit = limitArg ? Number(limitArg) : Infinity;
  if (!expect) { console.error('usage: --expect-db <database name> [--apply] [--limit N]'); return 2; }
  const current = ((await db.execute(sql`SELECT current_database() AS d`)).rows[0] as { d: string }).d;
  if (current !== expect) { console.error(`refusing: connected to ${current}, expected ${expect}`); return 2; }

  const hash = (s: string) => textHash(normalizeStatement(s));
  const snaps = (await db.execute(sql`
    SELECT DISTINCT ON (course_code, coalesce(instructor_name, '')) course_code, profile
    FROM course_capture_snapshots WHERE retired_at IS NULL
    ORDER BY course_code, coalesce(instructor_name, ''), created_at DESC`)).rows as Array<{ course_code: string; profile: Profile }>;
  const titles = new Map(((await db.execute(sql`SELECT code, title FROM courses`)).rows as Array<{ code: string; title: string }>).map(r => [r.code, r.title]));

  const uniq = (xs: Array<{ statement?: string }> | undefined) => [...new Set((xs ?? []).map(x => x.statement?.trim() ?? '').filter(Boolean))];
  const required: Skill[] = [], developed: Skill[] = [];
  for (const s of snaps) {
    for (const t of uniq(s.profile?.incoming_expectations)) required.push({ course: s.course_code, text: t, ref: hash(t) });
    for (const t of uniq(s.profile?.competencies)) developed.push({ course: s.course_code, text: t, ref: hash(t) });
  }

  const items = [...new Map([...required, ...developed].map(s => [s.ref, { kind: 'course_skill' as const, ref: s.ref, text: s.text }])).values()];
  if (apply) {
    const r = await embedMissing(db, items, DEFAULT_EMBEDDING_MODEL, texts => embedBatch(texts));
    console.log(`embeddings: ${r.cached} cached, ${r.embedded} newly embedded (campus model, no cost)`);
  }
  // readVectors keys on ref and checks sha256(text) against the stored row, so pass the same text embedMissing stored.
  const vecs = await readVectors(db, 'course_skill', items, DEFAULT_EMBEDDING_MODEL);

  const pairs = new Map<string, { requiredHash: string; suppliedHash: string; text: import('@/lib/ai/match-judge').PairText }>();
  let noVector = 0;
  for (const r of required.slice(0, limit)) {
    const rv = vecs.get(r.ref);
    if (!rv) { noVector++; continue; }
    const ranked = developed
      .filter(d => d.course !== r.course && vecs.has(d.ref))
      .map(d => ({ d, sim: cosine(rv, vecs.get(d.ref)!) }))
      .sort((a, b) => b.sim - a.sim);
    const seen = new Set<string>();
    for (const { d } of ranked) {
      if (seen.has(d.ref)) continue;
      seen.add(d.ref);
      if (seen.size > TOP) break;
      const key = `${r.ref}|${d.ref}`;
      if (pairs.has(key)) continue;
      pairs.set(key, { requiredHash: r.ref, suppliedHash: d.ref, text: {
        requiredText: r.text, requiredCourse: r.course, requiredTitle: titles.get(r.course) ?? '',
        suppliedText: d.text, suppliedCourse: d.course, suppliedTitle: titles.get(d.course) ?? '',
      } });
    }
  }
  const all = [...pairs.values()];
  console.log(`captures ${snaps.length}; required skills ${required.length}; developed skills ${developed.length}; required without a vector ${noVector}`);
  console.log(`candidate pairs (top ${TOP} per required skill, other courses): ${all.length}`);

  const todo: Array<{ model: (typeof MODELS)[number]; pairs: typeof all }> = [];
  for (const model of MODELS) {
    const cached = await readJudgments(all, model, PROMPT_VERSION);
    const missing = all.filter(p => !cached.has(`${p.requiredHash}|${p.suppliedHash}`));
    console.log(`${model}: ${all.length - missing.length} already cached, ${missing.length} to judge`);
    todo.push({ model, pairs: missing });
  }
  if (!apply) { console.log('DRY RUN: nothing judged or written.'); return 0; }

  for (const { model, pairs: missing } of todo) {
    if (missing.length === 0) continue;
    const t0 = Date.now();
    const out = await judgePairs(missing.map(p => p.text), { model, concurrency: 4 });
    const failed = out.filter(o => o.pFully === null || o.pPartly === null).length;
    await writeJudgments(missing.map((p, i) => ({
      requiredHash: p.requiredHash, suppliedHash: p.suppliedHash, model, promptVersion: PROMPT_VERSION,
      pFully: out[i]!.pFully, pPartly: out[i]!.pPartly,
    })));
    console.log(`${model}: judged ${missing.length} pairs in ${Math.round((Date.now() - t0) / 1000)}s, ${failed} with a missing probability (stored as null)`);
  }
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
