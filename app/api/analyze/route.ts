import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';
import { TelemetryAccumulator } from '@/lib/ai/analyze/accum';
import { draftCourseKUD } from '@/lib/ai/analyze/kud-draft-course';
import { extractCoursePrereqs } from '@/lib/ai/analyze/extract-prereqs';
import { scorePriorCoverage } from '@/lib/ai/analyze/score-prior-coverage';
import { analyzeCourseGaps } from '@/lib/ai/analyze/analyze-course-gaps';
import { evaluateCourseScaffolding } from '@/lib/ai/analyze/evaluate-course-scaffolding';
import { persistAnalyzeRun } from '@/lib/ai/analyze/persist';
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { resolveCourseContext } from '@/lib/ai/analyze/resolve-course-context';
import type { AnalysisResult, PriorCourseAnalysis } from '@/lib/domain/types';

export const maxDuration = 120;

const MAX_SYLLABUS_LEN = 20000;
const MAX_PRIOR_COURSES = 8;

const courseInputSchema = z.object({
  courseLabel: z.string().min(1).max(200),
  syllabusText: z.string().min(50).max(MAX_SYLLABUS_LEN),
});

const requestSchema = z.object({
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
  const { course, priorCoursework } = parsed.data;

  const guard = await applyAnalyzeGuards(req);
  if (guard.short) return guard.short;

  const accum = new TelemetryAccumulator();
  const started = Date.now();

  // Warm the prompt cache before the parallel rounds.
  await Promise.all([
    loadPrompt('draft-course-outcomes'),
    loadPrompt('extract-course-prereqs'),
    loadPrompt('score-prior-coverage'),
    loadPrompt('analyze-course-gaps'),
    loadPrompt('evaluate-course-scaffolding'),
  ]);

  // Resolve course contexts: prefer course_profiles when available.
  const [resolvedCourseSyllabus, ...resolvedPriorSyllabi] = await Promise.all([
    resolveCourseContext(course.courseLabel, course.syllabusText),
    ...priorCoursework.map(c => resolveCourseContext(c.courseLabel, c.syllabusText)),
  ]);

  // Round 1 (parallel): Draft KUDs for the focal course + all prior courses.
  const round1 = await Promise.all([
    draftCourseKUD({ syllabusText: resolvedCourseSyllabus! }),
    ...priorCoursework.map((_, i) => draftCourseKUD({ syllabusText: resolvedPriorSyllabi[i]! })),
  ]);
  const courseKudResult = round1[0]!;
  const priorKudResults = round1.slice(1);
  for (const r of round1) accum.add(r.telemetry);
  const courseKud = courseKudResult.data;
  const priorKuds = priorKudResults.map(r => r.data);

  // Round 2: Extract the focal course's prerequisite competencies from its KUDs.
  const prereqResult = await extractCoursePrereqs({
    syllabusText: resolvedCourseSyllabus!,
    courseKud,
  });
  accum.add(prereqResult.telemetry);
  const prereqCompetencies = prereqResult.data;

  // Round 3 (parallel): Score each prior course against the prereq competencies.
  const priorCoverageResults = await Promise.all(
    priorCoursework.map((c, i) => scorePriorCoverage({
      prereqCompetencies,
      priorCourseLabel: c.courseLabel,
      priorCourseKud: priorKuds[i]!,
    }))
  );
  for (const r of priorCoverageResults) accum.add(r.telemetry);
  const priorCoverages = priorCoverageResults.map(r => r.data);

  // Round 4 (parallel): Gap analysis + scaffolding evaluation.
  const priorWithLevels = priorCoursework.map((c, i) => ({
    label: c.courseLabel,
    level: parseLevelFromLabel(c.courseLabel),
    coverage: priorCoverages[i]!,
  }));

  const [gapCall, scaffoldingCall] = await Promise.all([
    analyzeCourseGaps({
      prereqCompetencies,
      priorCoursework: priorCoursework.map((c, i) => ({ courseLabel: c.courseLabel, coverage: priorCoverages[i]! })),
    }),
    evaluateCourseScaffolding({
      prereqCompetencies,
      priorCourses: priorWithLevels,
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
      prerequisiteGaps: gapCall.data,
    },
    prereqCompetencies,
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
    careerTargetId: 'course-centric',
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
