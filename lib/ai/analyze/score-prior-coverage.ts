import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { coverageScoresSchema, coverageScoresJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, CoursePrereqCompetency, KUDOutcomes } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface ScorePriorCoverageArgs {
  prereqCompetencies: CoursePrereqCompetency[];
  priorCourseLabel: string;
  priorCourseKud: KUDOutcomes;
}

function buildPrereqContext(prereqs: CoursePrereqCompetency[]): string {
  const lines = ['Prerequisite competencies for the focal course:'];
  for (const p of prereqs) {
    lines.push(`- id=${p.id} :: ${p.name} (expected: ${p.expectedKudLevel})`);
    lines.push(`    Know: ${p.knowDescriptor}`);
    lines.push(`    Understand: ${p.understandDescriptor}`);
    lines.push(`    Do: ${p.doDescriptor}`);
  }
  return lines.join('\n');
}

export async function scorePriorCoverage({ prereqCompetencies, priorCourseLabel, priorCourseKud }: ScorePriorCoverageArgs): Promise<{
  data: CoverageScore[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('score-prior-coverage');
  const provider = getProvider();
  const prereqContext = buildPrereqContext(prereqCompetencies);
  const userMessage = [
    prereqContext,
    '',
    `Prior course: ${priorCourseLabel}`,
    `Course description: ${priorCourseKud.description}`,
    `Know outcomes: ${priorCourseKud.know.map(b => `- ${b}`).join('\n')}`,
    `Understand outcomes: ${priorCourseKud.understand.map(b => `- ${b}`).join('\n')}`,
    `Do outcomes: ${priorCourseKud.do.map(b => `- ${b}`).join('\n')}`,
  ].join('\n');
  const result = await provider.complete({
    systemPrompt,
    userMessage,
    schemaName: 'coverage_scores',
    jsonSchema: coverageScoresJsonSchema,
    validate: (raw) => coverageScoresSchema.parse((raw as { scores: unknown }).scores),
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
