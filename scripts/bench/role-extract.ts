#!/usr/bin/env tsx
/**
 * Extract-role benchmark for campus models (spec
 * docs/superpowers/specs/2026-11-01-local-models-and-role-benchmark-design.md).
 *
 * Material digests and chunk notes already run on campus gpt-oss-120b (chosen
 * 2026-06-17, no OpenAI fallback since 2026-06-16), so this covers the other
 * Extract functions that have real inputs in the bench copy: material-classify,
 * materials-analysis, ingestion-checkin, parse-profile-fields and
 * decompose-prereq-gap (jd-extract has no positions to read). One model per
 * process, pinned with CAMPUS_LLM_DEFAULT_MODEL and CAMPUS_LLM_REASONING.
 * Records JSON failures, speed and each output for a blind check against the
 * source. Campus only, bench DB only, writes nothing:
 *   env -i … DATABASE_URL=<bench> AI_PROVIDER=campus CAMPUS_LLM_BASE_URL=… CAMPUS_LLM_API_KEY=… \
 *     CAMPUS_LLM_DEFAULT_MODEL=glm-5.3 CAMPUS_LLM_REASONING=off OUT=… pnpm exec tsx scripts/bench/role-extract.ts
 */
import { writeFileSync } from 'node:fs';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots, courseMaterials, courses } from '@/lib/db/schema';
import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { analyzeMaterial } from '@/lib/ai/course-profile/analyze-material';
import { generateIngestionCheckIn, type CheckInInput } from '@/lib/ai/analyze/ingestion-checkin';
import { parseProfileFields } from '@/lib/ai/analyze/parse-profile-fields';
import { mergePrereqGapWithSkills } from '@/lib/ai/analyze/decompose-prereq-gap';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';

if (process.env.OPENAI_API_KEY) throw new Error('Unset OPENAI_API_KEY: this benchmark must not reach a paid model');
if (process.env.AI_PROVIDER !== 'campus') throw new Error('Set AI_PROVIDER=campus');
if (!process.env.CAMPUS_LLM_DEFAULT_MODEL) throw new Error('Pin CAMPUS_LLM_DEFAULT_MODEL: without it the stored OpenAI model name would go to the gateway and spend credits');
if (!/gc_curriculum_bench/.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL must be the gc_curriculum_bench copy');

const OUT = process.env.OUT ?? 'role-extract.json';
interface Result { fn: string; item: string; ok: boolean; ms: number; output?: unknown; error?: string }
const results: Result[] = [];

async function timed(fn: string, item: string, run: () => Promise<unknown>) {
  const t0 = Date.now();
  try {
    results.push({ fn, item, ok: true, ms: Date.now() - t0, output: await run() });
    results[results.length - 1]!.ms = Date.now() - t0;
    process.stdout.write('.');
  } catch (e) {
    results.push({ fn, item, ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 300) });
    process.stdout.write('x');
  }
}
async function inBatches<T>(xs: T[], n: number, f: (x: T) => Promise<void>) {
  for (let i = 0; i < xs.length; i += n) await Promise.all(xs.slice(i, i + n).map(f));
}

/** Mirrors classifyFile's LLM path (lib/capture/material-tier.ts), which hides errors as 'background'. */
async function classify(m: { fileName: string; mimeType: string; sizeBytes: number; pageCount: number | null; peek: string }) {
  const lines = [`filename: ${m.fileName}`, `mime_type: ${m.mimeType}`, `size_bytes: ${m.sizeBytes}`];
  if (m.pageCount != null) lines.push(`page_count: ${m.pageCount}`);
  if (m.peek) lines.push('', 'peek_text (first ~500 chars):', m.peek.slice(0, 500));
  lines.push('', 'Return JSON: {"tier":"high"|"middle"|"background"}');
  const provider = await getProviderForFunction('material-classify');
  const { data } = await provider.complete<{ tier: string }>({
    systemPrompt: await loadPrompt('material-classify'), userMessage: lines.join('\n'), schemaName: 'material_classify',
    jsonSchema: { type: 'object', properties: { tier: { type: 'string', enum: ['high', 'middle', 'background'] } }, required: ['tier'], additionalProperties: false },
    validate: raw => { const t = (raw as { tier?: unknown }).tier; if (t !== 'high' && t !== 'middle' && t !== 'background') throw new Error(`bad tier ${String(t)}`); return { tier: t }; },
  });
  return data.tier;
}

async function main() {
  const live = and(isNull(courseMaterials.retiredAt), eq(courseMaterials.extractionStatus, 'ok'));
  // 1. material-classify: 20 non-slide uploaded files with a stored tier.
  const files = await db.select().from(courseMaterials)
    .where(and(live, isNull(courseMaterials.sourceCode), isNotNull(courseMaterials.tier),
      sql`${courseMaterials.mimeType} not ilike '%presentation%' and ${courseMaterials.fileName} not ilike '%.pptx' and ${courseMaterials.fileName} not ilike 'Canvas:%'`))
    .orderBy(asc(courseMaterials.id)).limit(20);
  // 2. materials-analysis: the materials with a stored finding.
  const analyzed = await db.select().from(courseMaterials).where(and(isNull(courseMaterials.retiredAt), isNotNull(courseMaterials.analysisFinding))).orderBy(asc(courseMaterials.id));
  // 3. ingestion-checkin and 5. decompose: six courses with a capture snapshot.
  const snaps = await db.selectDistinctOn([courseCaptureSnapshots.courseCode]).from(courseCaptureSnapshots)
    .orderBy(courseCaptureSnapshots.courseCode, desc(courseCaptureSnapshots.createdAt));
  const gapsOf = (s: (typeof snaps)[number]) => s.profile.audit_notes?.prereq_gaps ?? [];
  const withGaps = snaps.filter(s => gapsOf(s).length > 0).slice(0, 6);
  const checkinCourses = ['GC 1040', 'GC 3460', 'GC 3700', 'GC 3800', 'GC 4800', 'MKT 3310'];
  // 4. parse-profile-fields: six syllabi.
  const syllabi = await db.select().from(courseMaterials).where(and(live, eq(courseMaterials.isSyllabus, true))).orderBy(asc(courseMaterials.id)).limit(6);

  console.log(`model ${process.env.CAMPUS_LLM_DEFAULT_MODEL} ${process.env.CAMPUS_LLM_REASONING ?? 'default'}: classify ${files.length}, analysis ${analyzed.length}, checkin ${checkinCourses.length}, parse ${syllabi.length}, decompose ${withGaps.length}`);

  await inBatches(files, 5, m => timed('material-classify', m.id, async () => ({
    tier: await classify({ fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes, pageCount: m.pageCount, peek: m.extractedText ?? '' }),
    storedTier: m.tier })));
  await inBatches(analyzed, 3, async m => {
    const c = (await db.select().from(courses).where(eq(courses.code, m.courseCode)))[0]!;
    await timed('materials-analysis', m.id, async () => (await analyzeMaterial({
      courseContext: { code: c.code, title: c.title, level: c.level, track: c.track, description: c.description ?? '' },
      fileName: m.fileName, extractedText: m.extractedText ?? '' })).data);
  });
  await inBatches(checkinCourses, 3, async code => {
    const course = (await getCourseByCode(code))!;
    const all = await listMaterialsByCourse(code);
    const mats = all.filter(m => !m.ignored && m.extractionStatus === 'ok');
    const input: CheckInInput = {
      catalog: { code: course.code, title: course.title, learningObjectives: course.learningObjectives ?? [], majorProjects: course.majorProjects ?? [] },
      materials: mats.map(m => ({ fileName: m.fileName, autoSetAside: !!m.autoSetAside, setAsideReason: m.setAsideReason ?? null, digestSnippet: (m.digest ?? m.extractedText ?? '').slice(0, 400) })),
      context: {
        catalogCoversSyllabus: (course.learningObjectives ?? []).length > 0 && (course.majorProjects ?? []).length > 0,
        hasCanvasAssignments: mats.some(m => m.fileName === 'Canvas: Assignments'),
        canvasSyllabusSetAside: all.some(m => m.fileName === 'Canvas: Syllabus' && (m.ignored || m.autoSetAside)),
      },
    };
    await timed('ingestion-checkin', code, async () => { const r = await generateIngestionCheckIn(input); return { message: r.message, highlights: r.highlights }; });
  });
  await inBatches(syllabi, 3, m => timed('parse-profile-fields', m.id, async () => (await parseProfileFields(m.extractedText ?? '')) as unknown));
  await inBatches(withGaps, 3, async s => {
    const c = (await db.select().from(courses).where(eq(courses.code, s.courseCode)))[0]!;
    const gap = gapsOf(s)[0]!;
    await timed('decompose-prereq-gap', `${s.courseCode}: ${gap.slice(0, 60)}`, async () =>
      mergePrereqGapWithSkills({ gapText: gap, sourceCourseCode: s.courseCode, existingSkills: c.skillsRequired ?? [] }));
  });

  const byFn: Record<string, unknown> = {};
  for (const fn of [...new Set(results.map(r => r.fn))]) {
    const rs = results.filter(r => r.fn === fn), ok = rs.filter(r => r.ok);
    byFn[fn] = { n: rs.length, failures: rs.length - ok.length, meanSecs: ok.reduce((a, r) => a + r.ms, 0) / Math.max(ok.length, 1) / 1000,
      ...(fn === 'material-classify' ? { matchesStoredTier: ok.filter(r => (r.output as { tier: string; storedTier: string }).tier === (r.output as { storedTier: string }).storedTier).length } : {}) };
  }
  writeFileSync(OUT, JSON.stringify({ model: process.env.CAMPUS_LLM_DEFAULT_MODEL, reasoning: process.env.CAMPUS_LLM_REASONING ?? null, summary: byFn, results }, null, 1));
  console.log('\n' + JSON.stringify(byFn));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
