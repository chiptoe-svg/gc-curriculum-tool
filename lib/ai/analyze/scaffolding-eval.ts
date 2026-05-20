import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { scaffoldingScoresSchema, scaffoldingScoresJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, ScaffoldingScore } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface ScaffoldingCourse {
  label: string;
  level: number;
  coverage: CoverageScore[];
}

export interface EvaluateScaffoldingArgs {
  targetContext: string;
  courses: ScaffoldingCourse[];
  focalCourseLabel?: string;  // marks one as the course-being-analyzed in Tab 2; omit in Tab 1
}

export async function evaluateScaffolding({ targetContext, courses, focalCourseLabel }: EvaluateScaffoldingArgs): Promise<{
  data: ScaffoldingScore[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('evaluate-scaffolding');
  const provider = getProvider();
  const coursesText = courses.map(c => {
    const lines = c.coverage.map(s => `  - ${s.subCompetencyId}: ${s.kudLevel} (confidence ${s.confidence})`).join('\n');
    const marker = focalCourseLabel && c.label === focalCourseLabel ? ' (course being analyzed)' : '';
    return `[${c.label} — level ${c.level}${marker}]\n${lines}`;
  }).join('\n\n');
  const userMessage = `Career target:\n${targetContext}\n\nCourses in this analysis with their coverage of each sub-competency:\n\n${coursesText}`;
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
