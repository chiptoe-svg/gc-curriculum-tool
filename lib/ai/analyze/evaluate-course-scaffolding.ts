import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { scaffoldingScoresSchema, scaffoldingScoresJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, CoursePrereqCompetency, ScaffoldingScore } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface PriorCourseWithLevel {
  label: string;
  level: number;
  coverage: CoverageScore[];
}

export interface EvaluateCourseScaffoldingArgs {
  prereqCompetencies: CoursePrereqCompetency[];
  priorCourses: PriorCourseWithLevel[];
}

export async function evaluateCourseScaffolding({ prereqCompetencies, priorCourses }: EvaluateCourseScaffoldingArgs): Promise<{
  data: ScaffoldingScore[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('evaluate-course-scaffolding');
  const provider = getProvider();

  const prereqLines = prereqCompetencies.map(p =>
    `- id=${p.id} :: ${p.name} (expected: ${p.expectedKudLevel})`
  ).join('\n');

  const coursesText = priorCourses.map(c => {
    const lines = c.coverage.map(s => `  - ${s.subCompetencyId}: ${s.kudLevel} (confidence ${s.confidence})`).join('\n');
    return `[${c.label} — level ${c.level}]\n${lines}`;
  }).join('\n\n');

  const userMessage = [
    'Prerequisite competencies for the focal course:',
    prereqLines,
    '',
    'Prior courses and their coverage of each competency:',
    '',
    coursesText,
  ].join('\n');

  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'scaffolding_scores',
    jsonSchema: scaffoldingScoresJsonSchema,
    validate: (raw) => scaffoldingScoresSchema.parse((raw as { scaffolding: unknown }).scaffolding),
  });
  return {
    data: result.data,
    telemetry: {
      costUsdCents: result.costUsdCents,
      cachedTokens: result.cachedTokens,
      uncachedPromptTokens: result.uncachedPromptTokens,
      completionTokens: result.completionTokens,
    },
  };
}
