import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';
import { buildTargetContext } from '@/lib/ai/analyze/target-context';
import { TelemetryAccumulator } from '@/lib/ai/analyze/accum';
import { draftKUD } from '@/lib/ai/analyze/kud-draft';
import { scoreCoverage } from '@/lib/ai/analyze/coverage-score';
import { suggestPrereqs } from '@/lib/ai/analyze/prereq-suggest';
import { analyzeGaps } from '@/lib/ai/analyze/gap-analyze';
import { evaluateScaffolding } from '@/lib/ai/analyze/scaffolding-eval';
import { persistAnalyzeRun } from '@/lib/ai/analyze/persist';
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import type { AnalysisResult, PriorCourseAnalysis } from '@/lib/domain/types';

export const maxDuration = 120;

const MAX_SYLLABUS_LEN = 20000;
const MAX_PRIOR_COURSES = 8;

const courseInputSchema = z.object({
  courseLabel: z.string().min(1).max(200),
  syllabusText: z.string().min(50).max(MAX_SYLLABUS_LEN),
});

const requestSchema = z.object({
  careerTargetId: z.string().min(1).max(100),
  course: courseInputSchema,
  priorCoursework: z.array(courseInputSchema).min(1).max(MAX_PRIOR_COURSES),
});

function parseLevelFromLabel(label: string): number {
  const m = label.match(/GC\s+(\d)/i);
  return m ? parseInt(m[1]!, 10) : 0;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { careerTargetId, course, priorCoursework } = parsed.data;

  const target = await getTargetById(careerTargetId);
  if (!target) {
    return NextResponse.json({ error: `unknown careerTargetId: ${careerTargetId}` }, { status: 400 });
  }

  const guard = await applyAnalyzeGuards(req);
  if (guard.short) return guard.short;

  const targetContext = buildTargetContext(target);
  const accum = new TelemetryAccumulator();
  const started = Date.now();

  // Warm the prompt cache before the parallel rounds. Each helper awaits
  // loadPrompt internally; pre-warming makes those awaits resolve from cache
  // in one uniform microtask hop, so the Promise.all batches below invoke the
  // AI provider in stable array order while still running concurrently.
  await Promise.all([
    loadPrompt('draft-outcomes'),
    loadPrompt('score-coverage'),
    loadPrompt('suggest-prerequisites'),
    loadPrompt('analyze-prerequisite-gaps'),
    loadPrompt('evaluate-scaffolding'),
  ]);

  // Round 1 (parallel): N prior KUD drafts + 1 course KUD draft.
  const round1 = await Promise.all([
    ...priorCoursework.map(c => draftKUD({ targetContext, syllabusText: c.syllabusText })),
    draftKUD({ targetContext, syllabusText: course.syllabusText }),
  ]);
  const priorKudResults = round1.slice(0, priorCoursework.length);
  const courseKudResult = round1[priorCoursework.length]!;
  for (const c of round1) accum.add(c.telemetry);
  const priorKuds = priorKudResults.map(c => c.data);
  const courseKud = courseKudResult.data;

  // Round 2 (parallel): N prior coverage + 1 course coverage + 1 prereq suggestion.
  const [coverageResults, prereqResult] = await Promise.all([
    Promise.all([
      ...priorCoursework.map((c, i) => scoreCoverage({ targetContext, courseLabel: c.courseLabel, kud: priorKuds[i]! })),
      scoreCoverage({ targetContext, courseLabel: course.courseLabel, kud: courseKud }),
    ]),
    suggestPrereqs({ targetContext, courseKud }),
  ] as const);
  const priorCoverageResults = coverageResults.slice(0, priorCoursework.length);
  const courseCoverageResult = coverageResults[priorCoursework.length]!;
  for (const c of coverageResults) accum.add(c.telemetry);
  accum.add(prereqResult.telemetry);
  const priorCoverages = priorCoverageResults.map(c => c.data);
  const courseCoverage = courseCoverageResult.data;
  const prereqs = prereqResult.data;

  // Round 3 (parallel): gap analysis + scaffolding evaluation.
  const scaffoldingCourses = [
    { label: course.courseLabel, level: parseLevelFromLabel(course.courseLabel), coverage: courseCoverage },
    ...priorCoursework.map((c, i) => ({
      label: c.courseLabel,
      level: parseLevelFromLabel(c.courseLabel),
      coverage: priorCoverages[i]!,
    })),
  ];

  const [gapCall, scaffoldingCall] = await Promise.all([
    analyzeGaps({
      targetContext,
      prereqs,
      priorCoursework: priorCoursework.map((c, i) => ({ courseLabel: c.courseLabel, coverage: priorCoverages[i]! })),
    }),
    evaluateScaffolding({
      targetContext,
      courses: scaffoldingCourses,
      focalCourseLabel: course.courseLabel,
    }),
  ]);
  accum.add(gapCall.telemetry);
  accum.add(scaffoldingCall.telemetry);

  const priorCourseworkResult: PriorCourseAnalysis[] = priorCoursework.map((c, i) => ({
    courseLabel: c.courseLabel,
    kud: priorKuds[i]!,
    coverage: priorCoverages[i]!,
  }));

  const totals = accum.totals();
  const provider = getProvider();
  const result: AnalysisResult = {
    priorCoursework: priorCourseworkResult,
    course: {
      courseLabel: course.courseLabel,
      kud: courseKud,
      coverage: courseCoverage,
      prerequisiteCompetencies: prereqs,
      prerequisiteGaps: gapCall.data,
    },
    careerTargetId,
    scaffolding: scaffoldingCall.data,
    meta: {
      aiProvider: provider.name,
      aiModel: provider.model,
      durationMs: Date.now() - started,
      costUsdCents: totals.costUsdCents,
      cachedTokens: totals.cachedTokens,
      uncachedTokens: totals.uncachedPromptTokens,
      completionTokens: totals.completionTokens,
    },
  };

  const runId = await persistAnalyzeRun({
    ipHash: guard.ipHash,
    careerTargetId,
    courseLabel: course.courseLabel,
    courseSyllabus: course.syllabusText,
    priorCoursework: priorCoursework.map(c => ({ courseLabel: c.courseLabel, syllabus: c.syllabusText })),
    result,
    aiProvider: provider.name,
    aiModel: provider.model,
    costUsdCents: totals.costUsdCents,
    durationMs: result.meta.durationMs,
    analysisKind: 'course_prereqs',
  });

  return NextResponse.json({ ...result, runId });
}
