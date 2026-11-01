#!/usr/bin/env tsx
/**
 * Write-role benchmark for campus models (spec
 * docs/superpowers/specs/2026-11-01-local-models-and-role-benchmark-design.md).
 *
 * Runs the Write functions that have real inputs in the bench copy, through the
 * same code production uses, and stores each output beside the stored paid one
 * for a blind A/B read:
 *   - objective-evidence-guide: courses with a stored Sol guide, from that guide's snapshot
 *   - wiki-update: course pages whose wiki copy was written from the latest snapshot
 *   - bundle-card-draft: competencies with a confirmed card
 *   - explore-local-delta: stored Explore scenarios (their stored output predates
 *     today's profiles, so these are checked for acceptability only)
 * reconcile-feedback (no stored feedback), synthesize-target (no partner
 * submissions) and the position functions (no positions) have no inputs here.
 * One model per process, pinned with CAMPUS_LLM_DEFAULT_MODEL and
 * CAMPUS_LLM_REASONING. Campus only, bench DB only; the wiki repo is read, never written:
 *   env -i … DATABASE_URL=<bench> AI_PROVIDER=campus CAMPUS_LLM_BASE_URL=… CAMPUS_LLM_API_KEY=… \
 *     CAMPUS_LLM_DEFAULT_MODEL=qwen3.8-27b-fp8 CAMPUS_LLM_REASONING=off OUT=… pnpm exec tsx scripts/bench/role-write.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { bundleCards, courseExploreScenarios, courseObjectiveGuides } from '@/lib/db/schema';
import { getSnapshotById, getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { listActiveBundles } from '@/lib/db/bundle-queries';
import { generateObjectiveGuide } from '@/lib/objective-guide/generate';
import { pickSyllabus, usableAssignmentsText } from '@/lib/objective-guide/inputs';
import { updateWikiForSnapshot, courseCodeToSlug } from '@/lib/ai/wiki/update';
import { draftBundleCard } from '@/lib/ai/catalog/draft-bundle-card';
import { estimateLocalDelta } from '@/lib/ai/analyze/explore-local-delta';
import { loadNeighborContext } from '@/lib/ai/explore/run-impact';

if (process.env.OPENAI_API_KEY) throw new Error('Unset OPENAI_API_KEY: this benchmark must not reach a paid model');
if (process.env.AI_PROVIDER !== 'campus') throw new Error('Set AI_PROVIDER=campus');
if (!process.env.CAMPUS_LLM_DEFAULT_MODEL) throw new Error('Pin CAMPUS_LLM_DEFAULT_MODEL: without it the stored OpenAI model name would go to the gateway and spend credits');
if (!/gc_curriculum_bench/.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL must be the gc_curriculum_bench copy');

const OUT = process.env.OUT ?? 'role-write.json';
const WIKI = process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';
const GUIDE_COURSES = ['GC 3460', 'GC 3800', 'MKT 3310'];
const WIKI_COURSES = ['GC 3700', 'GC 4800'];
const CARD_IDS = (process.env.CARD_IDS ?? '').split(',').filter(Boolean);

interface Result { fn: string; item: string; ok: boolean; ms: number; output?: unknown; stored?: unknown; error?: string }
const results: Result[] = [];

async function timed(fn: string, item: string, stored: unknown, run: () => Promise<unknown>) {
  const t0 = Date.now();
  try {
    const output = await run();
    results.push({ fn, item, ok: true, ms: Date.now() - t0, output, stored });
    process.stdout.write('.');
  } catch (e) {
    results.push({ fn, item, ok: false, ms: Date.now() - t0, stored, error: (e as Error).message.slice(0, 300) });
    process.stdout.write('x');
  }
}

async function main() {
  console.log(`model ${process.env.CAMPUS_LLM_DEFAULT_MODEL} ${process.env.CAMPUS_LLM_REASONING ?? 'default'}`);

  // 1. objective-evidence-guide, from the snapshot the stored guide was built on.
  const guides = await db.select().from(courseObjectiveGuides).where(inArray(courseObjectiveGuides.courseCode, GUIDE_COURSES));
  await Promise.all(guides.map(async g => {
    const snap = await getSnapshotById(g.snapshotId);
    const course = await getCourseByCode(g.courseCode);
    const materials = await listMaterialsByCourse(g.courseCode);
    const syllabus = pickSyllabus(materials);
    const assignmentsText = usableAssignmentsText(materials);
    if (!snap || !course || syllabus.status !== 'ok' || assignmentsText === null) {
      results.push({ fn: 'objective-evidence-guide', item: g.courseCode, ok: false, ms: 0, error: 'inputs unavailable' });
      return;
    }
    await timed('objective-evidence-guide', g.courseCode, { model: g.model, guide: g.guide }, async () => {
      const r = await generateObjectiveGuide({ courseCode: g.courseCode, courseTitle: course.title, syllabi: syllabus.syllabi, assignmentsText, profile: snap.profile });
      return { guide: r.guide, droppedCount: r.droppedNames.length, attempts: r.attempts };
    });
  }));

  // 2. wiki-update, course page only, when the wiki copy came from the latest snapshot.
  for (const code of WIKI_COURSES) {
    const snap = await getLatestSnapshotByCourse(code);
    const rel = `courses/${courseCodeToSlug(code)}.md`;
    const stored = readFileSync(join(WIKI, rel), 'utf8');
    if (!snap || !stored.includes(`last_snapshot_id: ${snap.id}`)) {
      results.push({ fn: 'wiki-update', item: code, ok: false, ms: 0, error: 'wiki page not from the latest snapshot' });
      continue;
    }
    await timed('wiki-update', code, stored, async () => {
      const r = await updateWikiForSnapshot(snap.id, { pageTypes: ['course'] });
      return r.wiki.find(p => p.path.endsWith(rel))?.content ?? r.wiki.map(p => p.path);
    });
  }

  // 3. bundle-card-draft against the confirmed card.
  const catalog = await listActiveBundles();
  const cards = await db.select().from(bundleCards).where(eq(bundleCards.status, 'confirmed')).orderBy(asc(bundleCards.competencyId));
  for (const card of cards.filter(c => CARD_IDS.includes(c.competencyId))) {
    const bundle = catalog.find(b => b.id === card.competencyId);
    if (!bundle) continue;
    await timed('bundle-card-draft', card.competencyId, card, async () => (await draftBundleCard(bundle, catalog)).card);
  }

  // 4. explore-local-delta on the stored scenarios' change text.
  const scenarios = await db.select().from(courseExploreScenarios).orderBy(asc(courseExploreScenarios.createdAt)).limit(2);
  for (const s of scenarios) {
    const prose = (s.change as { prose?: string }).prose ?? '';
    await timed('explore-local-delta', `${s.courseCode}: ${prose.slice(0, 60)}`, { change: s.change, predictedDeltas: s.predictedDeltas }, async () => {
      const { context } = await loadNeighborContext(s.courseCode);
      return (await estimateLocalDelta(s.courseCode, prose, context)).result;
    });
  }

  const byFn: Record<string, unknown> = {};
  for (const fn of [...new Set(results.map(r => r.fn))]) {
    const rs = results.filter(r => r.fn === fn), ok = rs.filter(r => r.ok);
    byFn[fn] = { n: rs.length, failures: rs.length - ok.length, meanSecs: ok.reduce((a, r) => a + r.ms, 0) / Math.max(ok.length, 1) / 1000 };
  }
  writeFileSync(OUT, JSON.stringify({ model: process.env.CAMPUS_LLM_DEFAULT_MODEL, reasoning: process.env.CAMPUS_LLM_REASONING ?? null, summary: byFn, results }, null, 1));
  console.log('\n' + JSON.stringify(byFn));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
