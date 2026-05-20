import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { coverageScoresSchema, coverageScoresJsonSchema } from '@/lib/ai/schemas';
import type { CoverageScore, KUDOutcomes } from '@/lib/domain/types';
import type { CallTelemetry } from './accum';

export interface ScoreCoverageArgs {
  targetContext: string;
  courseLabel: string;
  kud: KUDOutcomes;
}

export async function scoreCoverage({ targetContext, courseLabel, kud }: ScoreCoverageArgs): Promise<{
  data: CoverageScore[];
  telemetry: CallTelemetry;
}> {
  const systemPrompt = await loadPrompt('score-coverage');
  const provider = getProvider();
  const userMessage = `Career target:\n${targetContext}\n\nCourse: ${courseLabel}\n\nCourse description: ${kud.description}\n\nKnow outcomes:\n${kud.know.map(b => `- ${b}`).join('\n')}\n\nUnderstand outcomes:\n${kud.understand.map(b => `- ${b}`).join('\n')}\n\nDo outcomes:\n${kud.do.map(b => `- ${b}`).join('\n')}`;
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
