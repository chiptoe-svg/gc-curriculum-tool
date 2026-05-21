import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { applyAnalyzeGuards } from '@/lib/ai/analyze/guards';
import { buildTargetContext } from '@/lib/ai/analyze/target-context';
import { TelemetryAccumulator } from '@/lib/ai/analyze/accum';
import { draftKUD } from '@/lib/ai/analyze/kud-draft';
import { scoreCoverage } from '@/lib/ai/analyze/coverage-score';
import { evaluateScaffolding } from '@/lib/ai/analyze/scaffolding-eval';
import { persistAnalyzeRun } from '@/lib/ai/analyze/persist';
import { getProvider } from '@/lib/ai/provider';
import { resolveCourseContext } from '@/lib/ai/analyze/resolve-course-context';
import type { TargetChainAnalysisResult, TargetChainCourseAnalysis } from '@/lib/domain/types';

export const maxDuration = 120;

const MAX_SYLLABUS_LEN = 20000;
const MIN_COURSES = 2;
const MAX_COURSES = 16;

const courseInputSchema = z.object({
  courseLabel: z.string().min(1).max(200),
  syllabusText: z.string().min(50).max(MAX_SYLLABUS_LEN),
});

const requestSchema = z.object({
  careerTargetId: z.string().min(1).max(100),
  courses: z.array(courseInputSchema).min(MIN_COURSES).max(MAX_COURSES),
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
  const { careerTargetId, courses } = parsed.data;

  const target = await getTargetById(careerTargetId);
  if (!target) {
    return NextResponse.json({ error: `unknown careerTargetId: ${careerTargetId}` }, { status: 400 });
  }

  const guard = await applyAnalyzeGuards(req);
  if (guard.short) return guard.short;

  // Sort courses by level ascending, then by label
  const sortedCourses = [...courses].sort((a, b) => {
    const la = parseLevelFromLabel(a.courseLabel);
    const lb = parseLevelFromLabel(b.courseLabel);
    if (la !== lb) return la - lb;
    return a.courseLabel.localeCompare(b.courseLabel);
  });

  const targetContext = buildTargetContext(target);
  const accum = new TelemetryAccumulator();
  const started = Date.now();

  // Resolve course contexts: prefer course_profiles when available.
  const resolvedSyllabi = await Promise.all(
    sortedCourses.map(c => resolveCourseContext(c.courseLabel, c.syllabusText))
  );

  // Round 1 (parallel): N KUD drafts
  const kudCalls = await Promise.all(
    sortedCourses.map((c, i) => draftKUD({ targetContext, syllabusText: resolvedSyllabi[i]! }))
  );
  for (const k of kudCalls) accum.add(k.telemetry);
  const kuds = kudCalls.map(c => c.data);

  // Round 2 (parallel): N coverage scores
  const coverageCalls = await Promise.all(
    sortedCourses.map((c, i) => scoreCoverage({ targetContext, courseLabel: c.courseLabel, kud: kuds[i]! }))
  );
  for (const c of coverageCalls) accum.add(c.telemetry);
  const coverages = coverageCalls.map(c => c.data);

  // Round 3: scaffolding across the chain
  const scaffoldingCall = await evaluateScaffolding({
    targetContext,
    courses: sortedCourses.map((c, i) => ({
      label: c.courseLabel,
      level: parseLevelFromLabel(c.courseLabel),
      coverage: coverages[i]!,
    })),
    // no focalCourseLabel — chain mode
  });
  accum.add(scaffoldingCall.telemetry);

  const courseResults: TargetChainCourseAnalysis[] = sortedCourses.map((c, i) => ({
    courseLabel: c.courseLabel,
    kud: kuds[i]!,
    coverage: coverages[i]!,
  }));

  const totals = accum.totals();
  const provider = getProvider();
  const result: TargetChainAnalysisResult = {
    careerTargetId,
    courses: courseResults,
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

  // courseLabel in prototype_runs is "the focal one"; for target-chain there's
  // no focal, so we store the first sorted label as a representative anchor.
  // courseSyllabus stores nothing — the syllabi are captured in priorCoursework.
  const runId = await persistAnalyzeRun({
    ipHash: guard.ipHash,
    careerTargetId,
    courseLabel: null,
    courseSyllabus: '',
    priorCoursework: sortedCourses.map(c => ({ courseLabel: c.courseLabel, syllabus: c.syllabusText })),
    result,
    aiProvider: provider.name,
    aiModel: provider.model,
    costUsdCents: totals.costUsdCents,
    durationMs: result.meta.durationMs,
    analysisKind: 'target_chain',
  });

  return NextResponse.json({ ...result, runId });
}
