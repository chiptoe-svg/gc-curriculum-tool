import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { prerequisiteGapsSchema, prerequisiteGapsJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, CoursePrereqCompetency, PrerequisiteGap } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface AnalyzeCourseGapsArgs {
  prereqCompetencies: CoursePrereqCompetency[];
  priorCoursework: Array<{ courseLabel: string; coverage: CoverageScore[] }>;
}

export async function analyzeCourseGaps({ prereqCompetencies, priorCoursework }: AnalyzeCourseGapsArgs): Promise<{
  data: PrerequisiteGap[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('analyze-course-gaps');
  const provider = getProvider();

  const prereqLines = prereqCompetencies.map(p =>
    `- ${p.id} (expects ${p.expectedKudLevel}): ${p.name}`
  ).join('\n');

  const priorText = priorCoursework.map((c, i) => {
    const lines = c.coverage.map(
      s => `  - ${s.subCompetencyId}: ${s.kudLevel} (confidence ${s.confidence}) — ${s.reasoning}`
    ).join('\n');
    return `[Prior course ${i + 1}: ${c.courseLabel}]\n${lines}`;
  }).join('\n\n');

  const userMessage = [
    'Prerequisite competencies for the focal course:',
    prereqLines,
    '',
    'Prior coursework coverage of each competency:',
    '',
    priorText,
  ].join('\n');

  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'prerequisite_gaps',
    jsonSchema: prerequisiteGapsJsonSchema,
    validate: (raw) => prerequisiteGapsSchema.parse((raw as { gaps: unknown }).gaps),
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
